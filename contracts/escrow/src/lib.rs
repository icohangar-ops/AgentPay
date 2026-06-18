//! AgentPay Escrow Contract
//!
//! Holds CSPR payments between agents and service providers.
//! Flow: lock(payment) → verify(delivery) → release(to_provider)
//! If delivery fails or times out, the agent can refund.

#![no_std]

extern crate alloc;

use alloc::{boxed::Box, format, string::String, vec, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage, system},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    CLType, CLValue, EntryPoint, EntryPointAccess, EntryPointType, EntryPoints,
    Key, Parameter, U256, ApiError,
};

/// Named key for the escrow owner (deployer)
const OWNER_KEY: &str = "owner";
/// Named key for the payment count
const PAYMENT_COUNT_KEY: &str = "payment_count";
/// Prefix for individual payment keys
const PAYMENT_PREFIX: &str = "payment_";

/// Error codes
const ERR_NOT_OWNER: u32 = 1;
const ERR_ALREADY_RELEASED: u32 = 2;
const ERR_NOT_LOCKED: u32 = 3;
const ERR_NOT_PARTY: u32 = 5;

/// Payment status stored as u8
const STATUS_LOCKED: u8 = 0;
const STATUS_RELEASED: u8 = 1;
const STATUS_REFUNDED: u8 = 2;

/// Helper: store a value under a named key via a new URef
fn store_value<T: casper_types::CLTyped + casper_types::bytesrepr::ToBytes>(name: &str, value: T) {
    let uref = storage::new_uref(value);
    runtime::put_key(name, Key::from(uref));
}

/// Helper: read a value from a named key (stored via URef)
fn read_value<T: casper_types::CLTyped + casper_types::bytesrepr::FromBytes>(name: &str) -> T {
    let key = runtime::get_key(name)
        .unwrap_or_revert_with(ApiError::MissingKey);
    let uref = key.into_uref().unwrap_or_revert_with(ApiError::UnexpectedKeyVariant);
    storage::read(uref)
        .unwrap_or_revert()
        .unwrap_or_revert_with(ApiError::Read)
}

fn get_owner() -> Key {
    runtime::get_key(OWNER_KEY)
        .unwrap_or_revert_with(ApiError::MissingKey)
}

#[no_mangle]
pub extern "C" fn init() {
    let owner = runtime::get_caller();
    runtime::put_key(OWNER_KEY, Key::Account(owner));
    store_value(PAYMENT_COUNT_KEY, 0u64);
}

#[no_mangle]
pub extern "C" fn lock_payment() {
    let payment_id: u64 = runtime::get_named_arg("payment_id");
    let _amount: U256 = runtime::get_named_arg("amount");
    let agent: Key = runtime::get_named_arg("agent");
    let provider: Key = runtime::get_named_arg("provider");
    let service_id: String = runtime::get_named_arg("service_id");

    // Create a new purse to hold the escrowed funds
    // system::create_purse() returns a URef directly
    let escrow_purse = system::create_purse();

    // Store payment info as individual named keys
    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    runtime::put_key(&format!("{}_purse", payment_key), Key::from(escrow_purse));
    store_value(&format!("{}_amount", payment_key), _amount);
    runtime::put_key(&format!("{}_agent", payment_key), agent);
    runtime::put_key(&format!("{}_provider", payment_key), provider);
    store_value(&format!("{}_service_id", payment_key), service_id);
    store_value(&format!("{}_status", payment_key), STATUS_LOCKED);

    // Increment payment count — read from named key, not named arg
    let count: u64 = read_value(PAYMENT_COUNT_KEY);
    store_value(PAYMENT_COUNT_KEY, count + 1);
}

#[no_mangle]
pub extern "C" fn release_payment() {
    let _payment_id: u64 = runtime::get_named_arg("payment_id");

    let payment_key = format!("{}_{}", PAYMENT_PREFIX, _payment_id);

    // Check status
    let status_key = format!("{}_status", payment_key);
    let status: u8 = read_value(&status_key);

    if status != STATUS_LOCKED {
        runtime::revert(ERR_ALREADY_RELEASED);
    }

    // Get the provider address
    let provider_key = format!("{}_provider", payment_key);
    let _provider: Key = runtime::get_key(&provider_key)
        .unwrap_or_revert_with(ApiError::MissingKey);

    // Mark as released
    store_value(&status_key, STATUS_RELEASED);
}

#[no_mangle]
pub extern "C" fn refund_payment() {
    let _payment_id: u64 = runtime::get_named_arg("payment_id");

    let payment_key = format!("{}_{}", PAYMENT_PREFIX, _payment_id);

    // Only the agent or owner can refund
    let agent_key = format!("{}_agent", payment_key);
    let agent: Key = runtime::get_key(&agent_key)
        .unwrap_or_revert_with(ApiError::MissingKey);
    let caller = runtime::get_caller();
    let owner = get_owner();

    // Compare AccountHash values
    let caller_key = Key::Account(caller);
    if caller_key != agent && caller_key != owner {
        runtime::revert(ERR_NOT_PARTY);
    }

    // Check status
    let status_key = format!("{}_status", payment_key);
    let status: u8 = read_value(&status_key);

    if status != STATUS_LOCKED {
        runtime::revert(ERR_ALREADY_RELEASED);
    }

    // Mark as refunded
    store_value(&status_key, STATUS_REFUNDED);
}

#[no_mangle]
pub extern "C" fn get_payment() {
    let payment_id: u64 = runtime::get_named_arg("payment_id");
    let payment_key = format!("{}_{}", PAYMENT_PREFIX, payment_id);

    let status: u8 = read_value(&format!("{}_status", payment_key));

    let ret = (payment_id, status);
    runtime::ret(CLValue::from_t(ret).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_payment_count() {
    let count: u64 = read_value(PAYMENT_COUNT_KEY);
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

    let refund_params = vec![
        Parameter::new("payment_id", CLType::U64),
    ];
    entry_points.add_entry_point(EntryPoint::new(
        "refund_payment",
        refund_params,
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let get_payment_params = vec![Parameter::new("payment_id", CLType::U64)];
    entry_points.add_entry_point(EntryPoint::new(
        "get_payment",
        get_payment_params,
        CLType::Tuple2([Box::new(CLType::U64), Box::new(CLType::U8)]),
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
    let _entry_points = get_entry_points();
    // Auto-init on deploy
    init();
}