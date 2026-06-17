// ── Casper RPC Client ─────────────────────────────────────────────
// Direct JSON-RPC calls to Casper testnet node.

import { createHash } from 'crypto';
import { TESTNET } from './constants';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ChainInfo,
  AccountBalance,
  DeployInfo,
  OnChainBalance,
  ChainInfoResult,
  DeployStatusResult,
  HexString,
} from './types';
import { MOTES_PER_CSPR } from './constants';
import { fromHex, toHex } from './keys';

let rpcId = 0;

/** Make a JSON-RPC call to the Casper node */
async function rpcCall<T = unknown>(
  method: string,
  params: unknown[] = [],
  rpcUrl: string = TESTNET.rpcUrl,
): Promise<JsonRpcResponse<T>> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: ++rpcId,
    method,
    params,
  };

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as JsonRpcResponse<T>;

  if (data.error) {
    throw new Error(`RPC error ${data.error.code}: ${data.error.message}${data.error.data ? ` — ${data.error.data}` : ''}`);
  }

  return data;
}

/** Get chain info */
export async function getChainInfo(): Promise<ChainInfo> {
  const response = await rpcCall<ChainInfo>('chain_get_info');
  return response.result!;
}

/** Get the current state root hash */
export async function getStateRootHash(): Promise<string> {
  const response = await rpcCall<{ state_root_hash: string }>('chain_get_state_root_hash');
  return response.result!.state_root_hash;
}

/** Get the latest block */
export async function getLatestBlock(): Promise<{
  hash: string;
  header: { timestamp: string; era_id: number; height: number; state_root_hash: string };
}> {
  const response = await rpcCall<{
    block_with_signatures: {
      block: {
        hash: string;
        header: { timestamp: string; era_id: number; height: number; state_root_hash: string };
      };
    };
  }>('chain_get_block');
  const blockData = response.result?.block_with_signatures?.block;
  return {
    hash: blockData!.hash,
    header: blockData!.header,
  };
}

/**
 * Get the on-chain CSPR balance for an account.
 * Uses query_global_state to read the account's main purse balance.
 */
export async function getAccountBalance(publicKeyHex: HexString): Promise<OnChainBalance> {
  // Step 1: Get state root hash
  const stateRootHash = await getStateRootHash();

  // Step 2: Query the account to get its main purse URef
  const accountKey = publicKeyHex.startsWith('01') ? publicKeyHex : `01${publicKeyHex.replace(/^0x/, '')}`;

  const accountResponse = await rpcCall<{
    stored_value: {
      Account: {
        account_hash: string;
        main_purse: string;
        named_keys: unknown[];
      };
    };
  }>('query_global_state', [
    { StateRootHash: stateRootHash },
    `account-hash-${computeAccountHashHex(publicKeyHex)}`,
    [],
  ]);

  const account = accountResponse.result?.stored_value?.Account;
  if (!account) {
    // Account not found on chain — return zero balance
    return {
      publicKey: publicKeyHex,
      balanceMotes: '0',
      balanceCSPR: '0',
    };
  }

  // Step 3: Query the main purse balance
  const balanceResponse = await rpcCall<AccountBalance>('query_global_state', [
    { StateRootHash: stateRootHash },
    account.main_purse,
    [],
  ]);

  const balanceMotes = balanceResponse.result?.stored_value?.balance ?? '0';
  const motes = BigInt(balanceMotes);
  const wholeCSPR = motes / MOTES_PER_CSPR;
  const remainder = motes % MOTES_PER_CSPR;
  const balanceCSPR = `${wholeCSPR}.${remainder.toString().padStart(9, '0').replace(/0+$/, '')}`;

  return {
    publicKey: publicKeyHex,
    balanceMotes,
    balanceCSPR,
  };
}

/** Compute account hash hex from public key hex */
function computeAccountHashHex(publicKeyHex: HexString): string {
  const clean = publicKeyHex.replace(/^0x/, '');
  // Strip Casper key tag if present
  const rawHex = clean.length === 66 ? clean.slice(2) : clean;
  const pubBytes = fromHex(rawHex);

  const hash = createHash('blake2b512').update(pubBytes).digest();
  // Account hash is first 32 bytes
  return toHex(hash.slice(0, 32));
}

/**
 * Submit a signed deploy to the network.
 * Returns the deploy hash.
 */
export async function putDeploy(deployJson: Record<string, unknown>): Promise<string> {
  const response = await fetch(TESTNET.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'account_put_deploy',
      params: [deployJson],
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Deploy submission failed: ${data.error.message}`);
  }

  return data.result?.deploy_hash ?? 'unknown';
}

/**
 * Get deploy status and execution results.
 * Polls until the deploy is included in a block (with timeout).
 */
export async function getDeployStatus(
  deployHash: HexString,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 3000,
): Promise<DeployStatusResult> {
  const startTime = Date.now();
  const cleanHash = deployHash.replace(/^0x/, '');

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await rpcCall<DeployInfo>('info_get_deploy', [cleanHash]);

      if (response.result?.execution_results && response.result.execution_results.length > 0) {
        const execResult = response.result.execution_results[0];
        const result = execResult.result;

        if (result.Success) {
          const transfers = result.Success.transfers?.map((t) => ({
            amount: t.transfer.amount,
            to: t.transfer.to,
          })) ?? [];

          return {
            deployHash,
            status: 'confirmed',
            blockHash: execResult.block_hash,
            eraId: undefined,
            cost: result.Success.cost,
            transfers,
          };
        }

        if (result.Failure) {
          return {
            deployHash,
            status: 'failed',
            blockHash: execResult.block_hash,
            errorMessage: result.Failure.error_message,
            cost: result.Failure.cost,
            transfers: [],
          };
        }
      }
    } catch {
      // Deploy not found yet, keep polling
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    deployHash,
    status: 'pending',
  };
}

/**
 * Request CSPR from the testnet faucet.
 */
export async function requestFaucetFunds(publicKeyHex: HexString): Promise<{ success: boolean; message: string }> {
  try {
    const cleanKey = publicKeyHex.replace(/^0x/, '');
    const response = await fetch(TESTNET.faucetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: cleanKey.length === 66 ? cleanKey : `01${cleanKey}`,
        amount: '10000000000', // 10 CSPR
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, message: data.message || 'Faucet transfer submitted' };
    }

    const text = await response.text();
    return { success: false, message: `Faucet error: ${response.status} — ${text}` };
  } catch (err) {
    return { success: false, message: `Faucet request failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

/**
 * Get formatted chain info for the UI.
 */
export async function getChainInfoFormatted(): Promise<ChainInfoResult> {
  const statusResponse = await rpcCall<{
    api_version: string;
    protocol_version: string;
    chainspec_name: string;
    last_added_block_info: {
      hash: string;
      timestamp: string;
      era_id: number;
      height: number;
      state_root_hash: string;
    };
  }>('info_get_status');

  const status = statusResponse.result!;

  const block = await getLatestBlock();

  return {
    chainName: status.chainspec_name,
    chainId: 1,
    blockHeight: status.last_added_block_info.height,
    eraId: status.last_added_block_info.era_id,
    blockHash: status.last_added_block_info.hash,
    timestamp: status.last_added_block_info.timestamp,
    protocolVersion: status.protocol_version,
    stateRootHash: status.last_added_block_info.state_root_hash,
  };
}