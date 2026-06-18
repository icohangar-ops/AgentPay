//! AgentPay Service Registry Contract
//!
//! On-chain service catalog with pricing, endpoints, and provider addresses.
//! Services can be registered, updated, and queried on-chain.

#![no_std]

extern crate alloc;

use alloc::{format, string::String, vec, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    CLType, CLValue, EntryPoint, EntryPointAccess, EntryPointType, EntryPoints,
    Key, Parameter, ApiError,
};

const OWNER_KEY: &str = "owner";
const SERVICE_COUNT_KEY: &str = "service_count";
const SERVICE_PREFIX: &str = "service_";

const ERR_NOT_OWNER: u32 = 1;
const ERR_NOT_FOUND: u32 = 2;
const ERR_ALREADY_EXISTS: u32 = 3;

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

#[no_mangle]
pub extern "C" fn init() {
    let owner = runtime::get_caller();
    runtime::put_key(OWNER_KEY, Key::Account(owner));
    store_value(SERVICE_COUNT_KEY, 0u64);
}

#[no_mangle]
pub extern "C" fn register_service() {
    let service_id: String = runtime::get_named_arg("service_id");
    let name: String = runtime::get_named_arg("name");
    let endpoint: String = runtime::get_named_arg("endpoint");
    let price: u64 = runtime::get_named_arg("price");
    let provider: Key = runtime::get_named_arg("provider");

    let key = format!("{}_{}", SERVICE_PREFIX, service_id);

    // Check if already exists
    if runtime::get_key(&key).is_some() {
        runtime::revert(ERR_ALREADY_EXISTS);
    }

    // Store a marker URef to indicate this service exists
    store_value(&key, true);

    store_value(&format!("{}_name", key), name);
    store_value(&format!("{}_endpoint", key), endpoint);
    store_value(&format!("{}_price", key), price);
    runtime::put_key(&format!("{}_provider", key), provider);
    store_value(&format!("{}_active", key), true);

    // Increment count
    let count: u64 = read_value(SERVICE_COUNT_KEY);
    store_value(SERVICE_COUNT_KEY, count + 1);
}

#[no_mangle]
pub extern "C" fn update_price() {
    let service_id: String = runtime::get_named_arg("service_id");
    let new_price: u64 = runtime::get_named_arg("price");

    let key = format!("{}_{}", SERVICE_PREFIX, service_id);
    if runtime::get_key(&key).is_none() {
        runtime::revert(ERR_NOT_FOUND);
    }

    store_value(&format!("{}_price", key), new_price);
}

#[no_mangle]
pub extern "C" fn get_service_price() {
    let service_id: String = runtime::get_named_arg("service_id");
    let key = format!("{}_{}", SERVICE_PREFIX, service_id);

    if runtime::get_key(&key).is_none() {
        runtime::revert(ERR_NOT_FOUND);
    }

    let price: u64 = read_value(&format!("{}_price", key));
    runtime::ret(CLValue::from_t(price).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_service_count() {
    let count: u64 = read_value(SERVICE_COUNT_KEY);
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

    let register_params = vec![
        Parameter::new("service_id", CLType::String),
        Parameter::new("name", CLType::String),
        Parameter::new("endpoint", CLType::String),
        Parameter::new("price", CLType::U64),
        Parameter::new("provider", CLType::Key),
    ];
    entry_points.add_entry_point(EntryPoint::new(
        "register_service",
        register_params,
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let update_params = vec![
        Parameter::new("service_id", CLType::String),
        Parameter::new("price", CLType::U64),
    ];
    entry_points.add_entry_point(EntryPoint::new(
        "update_price",
        update_params,
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let get_price_params = vec![Parameter::new("service_id", CLType::String)];
    entry_points.add_entry_point(EntryPoint::new(
        "get_service_price",
        get_price_params,
        CLType::U64,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        "get_service_count",
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
    init();
}