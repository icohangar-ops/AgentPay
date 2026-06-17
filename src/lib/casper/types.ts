// ── Casper TypeScript Types ─────────────────────────────────────────

/** A public key in hex format (with or without 0x prefix) */
export type HexString = string;

/** Ed25519 keypair */
export interface Ed25519KeyPair {
  /** Private key bytes (Uint8Array, 32 bytes) — KEEP SECRET */
  privateKey: Uint8Array;
  /** Public key bytes (Uint8Array, 32 bytes) */
  publicKey: Uint8Array;
  /** Public key in hex with 0x prefix */
  publicKeyHex: string;
  /** Account hash derived from public key (hex with 0x prefix) */
  accountHash: string;
}

/** Deploy header */
export interface DeployHeader {
  account: HexString;
  timestamp: string;
  ttl: string;
  gas_price: string;
  body_hash: HexString;
  dependencies: HexString[];
  chain_name: string;
}

/** Account identifier for Transfer target */
export type AccountIdentifier =
  | { AccountHash: HexString }
  | { PublicKey: HexString };

/** Transfer session args */
export interface TransferArgs {
  amount: string;
  target: AccountIdentifier;
  id: number | null;
  transfer_id: null;
}

/** Deploy approval (signature) */
export interface Approval {
  signer: HexString;
  signature: HexString;
}

/** Full deploy structure */
export interface Deploy {
  hash: HexString;
  header: DeployHeader;
  payment: { StandardPayment: string };
  session: { Transfer: TransferArgs };
  approvals: Approval[];
}

/** Submit-ready deploy wrapper */
export interface SubmitDeploy {
  deploy: Deploy;
}

/** JSON-RPC request */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown[];
}

/** JSON-RPC response (generic) */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: string;
  };
}

/** Chain info from chain_get_info */
export interface ChainInfo {
  api_version: string;
  chain_name: string;
  chain_id: number;
  last_added_block_info: {
    hash: string;
    timestamp: string;
    era_id: number;
    height: number;
    state_root_hash: string;
    creator: string;
  };
  parent_hash: string;
  protocol_version: string;
}

/** Account balance from query_global_state */
export interface AccountBalance {
  purse_uref: string;
  balance: string;
}

/** Deploy info from info_get_deploy */
export interface DeployInfo {
  deploy: {
    hash: string;
    header: DeployHeader;
    payment: { StandardPayment: string };
    session: Record<string, unknown>;
    approvals: Approval[];
  };
  execution_results: Array<{
    block_hash: string;
    result: {
      Success?: {
        transfers: Array<{ transfer: { id?: string; amount: string; to: string; source: string; target: string } }>;
        cost: string;
      };
      Failure?: {
        error_message: string;
        transfers: unknown[];
        cost: string;
      };
    };
  }>;
}

/** On-chain balance info returned from API */
export interface OnChainBalance {
  publicKey: HexString;
  balanceMotes: string;
  balanceCSPR: string;
}

/** Transfer result */
export interface TransferResult {
  deployHash: string;
  account: string;
  toAccount: string;
  amount: string;
  amountCSPR: string;
  chainName: string;
  explorerUrl: string;
}

/** Chain info returned from API */
export interface ChainInfoResult {
  chainName: string;
  chainId: number;
  blockHeight: number;
  eraId: number;
  blockHash: string;
  timestamp: string;
  protocolVersion: string;
  stateRootHash: string;
}

/** Deploy status result */
export interface DeployStatusResult {
  deployHash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'not_found';
  blockHash?: string;
  eraId?: number;
  cost?: string;
  errorMessage?: string;
  transfers?: Array<{ amount: string; to: string }>;
}