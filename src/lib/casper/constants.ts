// ── Casper Network Constants ─────────────────────────────────────────

/** 1 CSPR = 1,000,000,000 motes (9 decimals) */
export const MOTES_PER_CSPR = 1_000_000_000n;

/** Gas price for testnet deploys */
export const DEFAULT_GAS_PRICE = 1n;

/** Standard payment amount in motes (0.1 CSPR gas for transfers) */
export const STANDARD_PAYMENT = 100_000_000n;

/** Contract deploy payment amount in motes (5 CSPR) */
export const CONTRACT_DEPLOY_PAYMENT = 5_000_000_000n;

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
  /** Faucet page URL (web-only, no API) */
  faucetUrl: 'https://testnet.cspr.live/faucet',
} as const;

/** Ed25519 public key tag byte in Casper CLValue serialization */
export const KEY_TAG_ED25519 = 0x01;

// ── Deployed Contract Hashes ─────────────────────────────────────────
// These are populated after running: node scripts/deploy-contracts.mjs
// Until deployed, the app uses demo/off-chain mode for contract calls
// and real on-chain transfers (via native transfer deploys) for payments.

export const DEPLOYED_CONTRACTS = {
  /** Escrow contract hash (hex with 0x prefix) — set after deployment */
  escrowHash: process.env.NEXT_PUBLIC_ESCROW_CONTRACT_HASH || '',
  /** Service registry contract hash (hex with 0x prefix) — set after deployment */
  serviceRegistryHash: process.env.NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_HASH || '',
  /** Whether contracts are deployed and ready */
  isDeployed: !!(process.env.NEXT_PUBLIC_ESCROW_CONTRACT_HASH && process.env.NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_HASH),
} as const;