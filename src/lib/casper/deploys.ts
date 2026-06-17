// ── Deploy Builder ───────────────────────────────────────────────
// High-level API: build, sign, submit, and verify deploys.

import { TESTNET, MOTES_PER_CSPR, DEFAULT_TTL_MS, DEFAULT_GAS_PRICE, STANDARD_PAYMENT } from './constants';
import { generateKeyPair, signMessage, getPublicKeyCasperHex, toHex } from './keys';
import { buildTransferDeploy, createSignedDeploy, type BuildTransferDeployParams } from './serialization';
import { putDeploy, getDeployStatus, getAccountBalance, requestFaucetFunds } from './client';
import type { TransferResult, OnChainBalance, DeployStatusResult, ChainInfoResult } from './types';

export interface CreateAndSendTransferParams {
  /** Sender's Ed25519 private key (raw 32 bytes) */
  senderPrivateKey: Uint8Array;
  /** Sender's public key hex (with 0x prefix, without Casper tag) */
  senderPublicKeyHex: string;
  /** Recipient's public key hex (with 0x prefix, without Casper tag) */
  recipientPublicKeyHex: string;
  /** Amount to transfer in motes (BigInt) */
  amountMotes: bigint;
  /** Chain name (default: casper-testnet) */
  chainName?: string;
  /** Gas payment in motes */
  paymentAmount?: bigint;
  /** Transfer ID (optional, auto-assigned if null) */
  transferId?: number | null;
}

/**
 * Build, sign, and submit a transfer deploy in one call.
 * Returns the deploy hash and explorer URL.
 */
export async function createAndSendTransfer(
  params: CreateAndSendTransferParams,
): Promise<TransferResult> {
  const chainName = params.chainName ?? TESTNET.chainName;

  // Step 1: Build the unsigned deploy
  const built = buildTransferDeploy({
    fromPublicKey: getPublicKeyCasperHex(params.senderPublicKeyHex),
    toPublicKey: getPublicKeyCasperHex(params.recipientPublicKeyHex),
    amountMotes: params.amountMotes,
    chainName,
    gasPrice: DEFAULT_GAS_PRICE,
    ttlMs: DEFAULT_TTL_MS,
    paymentAmount: params.paymentAmount ?? STANDARD_PAYMENT,
    transferId: params.transferId ?? null,
  });

  // Step 2: Sign the deploy hash with sender's private key
  const signature = signMessage(built.deployHashBytes, params.senderPrivateKey);

  // Step 3: Create the signed deploy
  const signedDeploy = createSignedDeploy(
    built,
    getPublicKeyCasperHex(params.senderPublicKeyHex),
    signature,
  );

  // Step 4: Submit to the network
  const submitResult = await putDeploy(signedDeploy as unknown as Record<string, unknown>);

  // Step 5: Compute amounts for display
  const amountCSPR = formatMotesToCSPR(params.amountMotes);

  return {
    deployHash: built.deploy.hash,
    account: params.senderPublicKeyHex,
    toAccount: params.recipientPublicKeyHex,
    amount: params.amountMotes.toString(),
    amountCSPR,
    chainName,
    explorerUrl: `${TESTNET.explorerUrl}${built.deploy.hash.replace(/^0x/, '')}`,
  };
}

/**
 * Convenience: convert CSPR to motes.
 */
export function cspRToMotes(cspr: number | string): bigint {
  // Handle decimal CSPR amounts
  const str = typeof cspr === 'number' ? cspr.toString() : cspr;
  const parts = str.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = parts[1] || '';

  // Pad fraction to 9 digits (motes precision)
  const paddedFrac = frac.padEnd(9, '0').slice(0, 9);
  const fracMotes = BigInt(paddedFrac || '0');

  return whole * MOTES_PER_CSPR + fracMotes;
}

/**
 * Convenience: convert motes to formatted CSPR string.
 */
export function formatMotesToCSPR(motes: bigint | string): string {
  const m = BigInt(motes);
  const whole = m / MOTES_PER_CSPR;
  const remainder = m % MOTES_PER_CSPR;
  const frac = remainder.toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

// ── Re-exports for convenience ─────────────────────────────────────

export { generateKeyPair, signMessage, getPublicKeyCasperHex, toHex, fromHex } from './keys';
export { getAccountBalance, getDeployStatus, requestFaucetFunds, getChainInfoFormatted, putDeploy } from './client';
export type { Ed25519KeyPair, OnChainBalance, DeployStatusResult, TransferResult, ChainInfoResult } from './types';