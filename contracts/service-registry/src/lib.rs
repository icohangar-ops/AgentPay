//! AgentPay Service Registry Contract
//!
//! On-chain service catalog with pricing, endpoints, and provider addresses.
//! Services can be registered, updated, and queried on-chain.

#![no_std]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use casper_contract::{
    contract_api::runtime,
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    CLType, CLValue, EntryPoint, EntryPointAccess, EntryPointType, EntryPoints,
    Group, Key, Parameter, ApiError,
};

const OWNER_KEY: &str = "owner";
const SERVICE_COUNT_KEY: &str = "service_count";
const SERVICE_PREFIX: &str = "service_";

const ERR_NOT_OWNER: u32 = 1;
const ERR_NOT_FOUND: u32 = 2;
const ERR_ALREADY_EXISTS: u32 = 3;

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
    runtime::put_key(SERVICE_COUNT_KEY, CLValue::from_t(0u64).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn register_service() {
    let service_id: String = runtime::get_named_arg("service_id");
    let name: String = runtime::get_named_arg("name");
    let endpoint: String = runtime::get_named_arg("endpoint");
    let price: u64 = runtime::get_named_arg("price"); // price in motes (CSPR * 10^9)
    let provider: Key = runtime::get_named_arg("provider");

    let key = format!("{}_{}", SERVICE_PREFIX, service_id);

    // Check if already exists
    if runtime::get_key(&key).is_some() {
        runtime::revert(ERR_ALREADY_EXISTS);
    }

    runtime::put_key(&key, Key::from(format!("registered")));
    runtime::put_key(&format!("{}_name", key), Key::from(name));
    runtime::put_key(&format!("{}_endpoint", key), Key::from(endpoint));
    runtime::put_key(&format!("{}_price", key), CLValue::from_t(price).unwrap_or_revert());
    runtime::put_key(&format!("{}_provider", key), provider);
    runtime::put_key(&format!("{}_active", key), Key::from(true as u8));

    // Increment count
    let mut count: u64 = match runtime::get_key(SERVICE_COUNT_KEY) {
        Some(k) => {
            let cl: CLValue = k.into_cl_value().unwrap_or_revert();
            cl.into_t().unwrap_or_revert()
        }
        None => 0,
    };
    count += 1;
    runtime::put_key(SERVICE_COUNT_KEY, CLValue::from_t(count).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn update_price() {
    let service_id: String = runtime::get_named_arg("service_id");
    let new_price: u64 = runtime::get_named_arg("price");

    let key = format!("{}_{}", SERVICE_PREFIX, service_id);
    if runtime::get_key(&key).is_none() {
        runtime::revert(ERR_NOT_FOUND);
    }

    runtime::put_key(
        &format!("{}_price", key),
        CLValue::from_t(new_price).unwrap_or_revert(),
    );
}

#[no_mangle]
pub extern "C" fn get_service_price() {
    let service_id: String = runtime::get_named_arg("service_id");
    let key = format!("{}_{}", SERVICE_PREFIX, service_id);

    if runtime::get_key(&key).is_none() {
        runtime::revert(ERR_NOT_FOUND);
    }

    let price_key = runtime::get_key(&format!("{}_price", key))
        .unwrap_or_revert_with(ApiError::MissingKey);
    let price_cl: CLValue = price_key.into_cl_value().unwrap_or_revert();
    let price: u64 = price_cl.into_t().unwrap_or_revert();

    runtime::ret(CLValue::from_t(price).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_service_count() {
    let count: u64 = match runtime::get_key(SERVICE_COUNT_KEY) {
        Some(k) => {
            let cl: CLValue = k.into_cl_value().unwrap_or_revert();
            cl.into_t().unwrap_or_revert()
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
        update_params.clone(),
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let get_price_params = vec![Parameter::new("service_id", CLType::String)];
    entry_points.add_entry_point(EntryPoint::new(
        "get_service_price",
        get_price_params.clone(),
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
    let entry_points = get_entry_points();
    let default_group = Group::new("default", entry_points.iter().map(|ep| ep.name()).collect());
    runtime::add_contract_package_group("default_group", default_group);

    init();
}