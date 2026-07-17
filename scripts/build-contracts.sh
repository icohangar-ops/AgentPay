#!/usr/bin/env bash
# ── Build AgentPay's Rust contracts to Wasm ──────────────────────────
# This script handles the nightly toolchain requirement and the
# `--import-undefined` link flag needed for `casper-contract` 3.x.
# Output: contracts/target/wasm/{escrow,service_registry}.wasm

set -euo pipefail
cd "$(dirname "$0")/.."

# Ensure nightly + wasm32 target are installed
if ! rustup toolchain list | grep -q nightly; then
  echo "Installing Rust nightly..."
  rustup toolchain install nightly --profile minimal
fi
if ! rustup target list --installed --toolchain nightly | grep -q wasm32-unknown-unknown; then
  echo "Adding wasm32-unknown-unknown target to nightly..."
  rustup target add wasm32-unknown-unknown --toolchain nightly
fi

cd contracts

echo "Compiling contracts..."
RUSTFLAGS="-C link-arg=--import-undefined -C link-arg=--no-entry" \
  cargo +nightly build --release --target wasm32-unknown-unknown

mkdir -p target/wasm
cp target/wasm32-unknown-unknown/release/escrow.wasm target/wasm/escrow.wasm
cp target/wasm32-unknown-unknown/release/service_registry.wasm target/wasm/service_registry.wasm

echo "✓ Built:"
ls -la target/wasm/*.wasm
