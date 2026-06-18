//! AgentPay Escrow Contract
//!
//! Holds CSPR payments between agents and service providers.
//! Flow: lock(payment) → verify(delivery) → release(to_provider)
//! If delivery fails or times out, the agent can refund.

#![no_std]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    CLType, CLValue, EntryPoint, EntryPointAccess, EntryPointType, EntryPoints, Group,
    Parameter, RuntimeArgs, URef, U256, Key, ApiError,
};

/// Named key for the escrow owner (deployer)
const OWNER_KEY: &str = "owner";
/// Named key for the payment count
const PAYMENT_COUNT_KEY: &str = "payment_count";
/// Prefix for individual payment URefs
const PAYMENT_PREFIX: &str = "payment_";

/// Error codes
const ERR_NOT_OWNER: u32 = 1;
const ERR_ALREADY_LOCKED: u32 = 2;
const ERR_NOT_LOCKED: u32 = 3;
const ERR_ALREADY_RELEASED: u32 = 4;
const ERR_NOT_PARTY: u32 = 5;

#[repr(u16)]
enum EscrowEntryPoints {
    Init = 0,
    LockPayment = 1,
    ReleasePayment = 2,
    RefundPayment = 3,
    GetPayment = 4,
    GetPaymentCount = 5,
}

/// Payment status stored as u8
const STATUS_LOCKED: u8 = 0;
const STATUS_RELEASED: u8 = 1;
const STATUS_REFUNDED: u8 = 2;

fn get_named_uref(name: &str) -> URef {
    let key = runtime::get_key(name)
        .unwrap_or_revert_with(ApiError::MissingKey)
        .unwrap_or_revert_with(ApiError::UnexpectedKeyVariant);
    key.into_uref().unwrap_or_revert_with(ApiError::UnexpectedKeyVariant)
}

fn get_owner() -> Key {
    runtime::get_key(OWNER_KEY)
        .unwrap_or_revert_with(ApiError::MissingKey)
}

fn ensure_owner() {
    let owner = get_owner();
    let caller = runtime::get_caller();
    if owner != caller {
        runtime::revert(ERR_NOT_OWNER);
    }
}

#[no_mangle]
pub extern "C" fn init() {
    let owner = runtime::get_caller();
    runtime::put_key(OWNER_KEY, owner);
    runtime::put_key(PAYMENT_COUNT_KEY, CLValue::from_t(0u64).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn lock_payment() {
    let payment_id: u64 = runtime::get_named_arg(PAYMENT_PREFIX);
    let amount: U256 = runtime::get_named_arg("amount");
    let agent: Key = runtime::get_named_arg("agent");
    let provider: Key = runtime::get_named_arg("provider");
    let service_id: String = runtime::get_named_arg("service_id");

    // Create a new purse to hold the escrowed funds
    let escrow_purse = URef::new(runtime::create_purse());

    // Store payment info as a dictionary
    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    // Store individual fields
    runtime::put_key(&format!("{}_purse", payment_key), Key::URef(escrow_purse));
    runtime::put_key(&format!("{}_amount", payment_key), Key::U256(amount));
    runtime::put_key(&format!("{}_agent", payment_key), agent);
    runtime::put_key(&format!("{}_provider", payment_key), provider);
    runtime::put_key(&format!("{}_service_id", payment_key), Key::from(service_id));
    runtime::put_key(&format!("{}_status", payment_key), Key::from(STATUS_LOCKED));

    // Increment payment count
    let mut count: u64 = runtime::get_named_arg(PAYMENT_COUNT_KEY);
    count += 1;
    runtime::put_key(PAYMENT_COUNT_KEY, CLValue::from_t(count).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn release_payment() {
    let payment_id: u64 = runtime::get_named_arg(PAYMENT_PREFIX);

    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    // Check status
    let status_key = format!("{}_status", payment_key);
    let status: u8 = match runtime::get_key(&status_key) {
        Some(Key::from(s)) => s,
        _ => runtime::revert(ERR_NOT_LOCKED),
    };

    if status != STATUS_LOCKED {
        runtime::revert(ERR_ALREADY_RELEASED);
    }

    // Get the provider address
    let provider_key = format!("{}_provider", payment_key);
    let provider: Key = runtime::get_key(&provider_key)
        .unwrap_or_revert_with(ApiError::MissingKey);

    // Mark as released
    runtime::put_key(&status_key, Key::from(STATUS_RELEASED));
}

#[no_mangle]
pub extern "C" fn refund_payment() {
    let payment_id: u64 = runtime::get_named_arg(PAYMENT_PREFIX);

    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    // Only the agent or owner can refund
    let agent_key = format!("{}_agent", payment_key);
    let agent: Key = runtime::get_key(&agent_key)
        .unwrap_or_revert_with(ApiError::MissingKey);
    let caller = runtime::get_caller();
    let owner = get_owner();

    if caller != agent && caller != owner {
        runtime::revert(ERR_NOT_PARTY);
    }

    // Check status
    let status_key = format!("{}_status", payment_key);
    let status: u8 = match runtime::get_key(&status_key) {
        Some(Key::from(s)) => s,
        _ => runtime::revert(ERR_NOT_LOCKED),
    };

    if status != STATUS_LOCKED {
        runtime::revert(ERR_ALREADY_RELEASED);
    }

    // Mark as refunded
    runtime::put_key(&status_key, Key::from(STATUS_REFUNDED));
}

#[no_mangle]
pub extern "C" fn get_payment() {
    let payment_id: u64 = runtime::get_named_arg(PAYMENT_PREFIX);
    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    let status: u8 = match runtime::get_key(&format!("{}_status", payment_key)) {
        Some(Key::from(s)) => s,
        _ => runtime::revert(ERR_NOT_LOCKED),
    };

    let ret = (payment_id, status);
    runtime::ret(CLValue::from_t(ret).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_payment_count() {
    let count: u64 = match runtime::get_key(PAYMENT_COUNT_KEY) {
        Some(key) => {
            let cl_value: CLValue = key.into_cl_value().unwrap_or_revert();
            cl_value.into_t().unwrap_or_revert()
        }
        None => 0,
    };
    runtime::ret(CLValue::from_t(count).unwrap_or_revert());
}

fn get_entry_points() -> EntryPoints {
    let mut entry_points = EntryPoints::new();

    entry_points.add_entry_point(EntryPoint::new(
        "init",
        Vec::new(),
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let lock_params = vec![
        Parameter::new("payment_id", CLType::U64),
        Parameter::new("amount", CLType::U256),
        Parameter::new("agent", CLType::Key),
        Parameter::new("provider", CLType::Key),
        Parameter::new("service_id", CLType::String),
    ];
    entry_points.add_entry_point(EntryPoint::new(
        "lock_payment",
        lock_params,
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let release_params = vec![
        Parameter::new("payment_id", CLType::U64),
    ];
    entry_points.add_entry_point(EntryPoint::new(
        "release_payment",
        release_params,
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "refund_payment",
        release_params.clone(),
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "get_payment",
        release_params.clone(),
        CLType::Tuple2(Box::new(CLType::U64), Box::new(CLType::U8)),
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "get_payment_count",
        Vec::new(),
        CLType::U64,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points
}

#[no_mangle]
pub extern "C" fn call() {
    // For contract deployment via deploy — calls init
    let entry_points = get_entry_points();
    let default_group = Group::new("default", entry_points.iter().map(|ep| ep.name()).collect());
    runtime::add_contract_package_group("default_group", default_group);

    // Auto-init on deploy
    init();
}