// ── Casper Network Constants ─────────────────────────────────────────

/** 1 CSPR = 1,000,000,000 motes (9 decimals) */
export const MOTES_PER_CSPR = 1_000_000_000n;

/** Gas price for testnet deploys */
export const DEFAULT_GAS_PRICE = 1n;

/** Standard payment amount in motes (1 CSPR gas) */
export const STANDARD_PAYMENT = 100_000_000n;

/** Default TTL for deploys: 30 minutes in milliseconds */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Casper testnet configuration */
export const TESTNET = {
  /** JSON-RPC endpoint for Casper testnet */
  rpcUrl: 'https://node.testnet.casper.network/rpc',
  /** Chain name used in deploy header */
  chainName: 'casper-test',
  /** Block explorer base URL */
  explorerUrl: 'https://testnet.cspr.live/deploy/',
  /** Account explorer base URL */
  accountExplorerUrl: 'https://testnet.cspr.live/account/',
  /** Faucet endpoint */
  faucetUrl: 'https://faucet.testnet.casper.network/api/v1/faucet',
} as const;

/** Ed25519 public key tag byte in Casper CLValue serialization */
export const KEY_TAG_ED25519 = 0x01;