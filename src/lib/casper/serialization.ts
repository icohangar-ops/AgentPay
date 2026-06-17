// ── Casper Binary Serialization ────────────────────────────────────
// Implements the Casper CLValue binary serialization format.
// Reference: https://github.com/casper-network/casper-node/blob/develop/serialization/src/

import { createHash } from 'crypto';
import type { Deploy, DeployHeader, TransferArgs, AccountIdentifier, HexString, Approval } from './types';
import { KEY_TAG_ED25519 } from './constants';

// ── Low-level serializers ─────────────────────────────────────────

/** Write a u8 */
function writeU8(val: number): Uint8Array {
  return new Uint8Array([val & 0xff]);
}

/** Write a u32 (little-endian) */
function writeU32(val: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, val, true); // little-endian
  return new Uint8Array(buf);
}

/** Write a u64 (little-endian) from a BigInt or number */
function writeU64(val: bigint | number): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(val), true); // little-endian
  return new Uint8Array(buf);
}

/** Write a u512 in Casper format.
 *  Format: 4-byte LE length prefix + bytes in big-endian order.
 */
function writeU512(val: bigint | string): Uint8Array {
  const n = BigInt(val);
  if (n === 0n) {
    // Zero is encoded as 0-length bytes
    return concat(writeU32(0));
  }

  // Convert to minimal big-endian bytes
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  // Prepend with 4-byte LE length
  return concat(writeU32(bytes.length), bytes);
}

/** Write a raw 32-byte hash (no length prefix, no tag) */
function writeHash(hex: HexString): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Write a string: 4-byte LE length prefix + UTF-8 bytes */
function writeString(val: string): Uint8Array {
  const encoded = new TextEncoder().encode(val);
  return concat(writeU32(encoded.length), encoded);
}

/** Write a PublicKey (Ed25519): tag byte 0x01 + 32 raw bytes */
function writePublicKey(hex: HexString): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  // Strip the Casper tag prefix if present (first 2 hex chars = 1 byte)
  const rawHex = clean.length === 66 ? clean.slice(2) : clean;
  const bytes = new Uint8Array(33);
  bytes[0] = KEY_TAG_ED25519;
  for (let i = 0; i < 32; i++) {
    bytes[i + 1] = parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Write Option<T>: 1 byte tag (0=None, 1=Some) + optional inner */
function writeOption<T>(val: T | null | undefined, writer: (v: T) => Uint8Array): Uint8Array {
  if (val === null || val === undefined) {
    return writeU8(0);
  }
  return concat(writeU8(1), writer(val as T));
}

/** Write Vec<T>: 4-byte LE length + elements */
function writeVec<T>(items: T[], writer: (v: T) => Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [writeU32(items.length)];
  for (const item of items) {
    parts.push(writer(item));
  }
  return concat(...parts);
}

/** Write a URef: 32 bytes + 1 byte access rights */
function writeURef(uref: string): Uint8Array {
  // URef format: "uref-<hex>-<access>"
  const match = uref.match(/^uref-([0-9a-fA-F]{64})-([0-9]{3})$/);
  if (!match) throw new Error(`Invalid URef format: ${uref}`);
  return concat(writeHash(match[1]), writeU8(parseInt(match[2])));
}

// ── Concatenate multiple Uint8Arrays ───────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── Section serializers ────────────────────────────────────────────

/** Serialize a DeployHeader to Casper binary */
function serializeHeader(header: DeployHeader): Uint8Array {
  return concat(
    // account: PublicKey
    writePublicKey(header.account),
    // timestamp: u64 (milliseconds)
    writeU64(new Date(header.timestamp).getTime()),
    // ttl: u64 (milliseconds) — parse "30m" etc.
    writeU64(parseTTL(header.ttl)),
    // gas_price: U512
    writeU512(header.gas_price),
    // body_hash: 32 raw bytes
    writeHash(header.body_hash),
    // dependencies: Vec<DeployHash>
    writeVec(header.dependencies, (h) => writeHash(h)),
    // chain_name: String
    writeString(header.chain_name),
  );
}

/** Parse a TTL string like "30m", "1h" into milliseconds */
function parseTTL(ttl: string): number {
  const match = ttl.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return parseInt(ttl) || 1800000;
  const val = parseInt(match[1]);
  switch (match[2]) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60000;
    case 'h': return val * 3600000;
    default: return val;
  }
}

/** Serialize payment (StandardPayment) */
function serializePayment(amount: string): Uint8Array {
  // Tag for StandardPayment: CLType tag + inner
  // The serialization of StandardPayment is just the U512 amount
  // preceded by the payment variant tag (0 = StandardPayment)
  return concat(writeU8(0), writeU512(amount));
}

/** Serialize session (Transfer) */
function serializeTransfer(args: TransferArgs): Uint8Array {
  // Transfer is session variant tag 7, followed by args
  // Session serialization: tag byte + serialized args
  const argsBytes = serializeTransferArgs(args);
  return concat(writeU8(7), writeU32(argsBytes.length), argsBytes);
}

/** Serialize Transfer named args */
function serializeTransferArgs(args: TransferArgs): Uint8Array {
  const parts: Uint8Array[] = [];

  // NamedArg count: 3 (amount, target, id)
  parts.push(writeU32(3));

  // Arg 1: "amount" -> U512
  parts.push(serializeNamedArg('amount', 5, writeU512(args.amount))); // 5 = CLType U512 tag

  // Arg 2: "target" -> AccountIdentifier
  parts.push(serializeNamedArg('target', 17, serializeAccountIdentifier(args.target))); // 17 = AccountIdentifier

  // Arg 3: "id" -> Option<u64>
  parts.push(serializeNamedArg('id', 14, writeOption(args.id, (v) => writeU64(v)))); // 14 = Option<u64>

  return concat(...parts);
}

/** Serialize a named argument: name_length + name + CLType tag + value */
function serializeNamedArg(name: string, clTypeTag: number, valueBytes: Uint8Array): Uint8Array {
  const nameBytes = writeString(name);
  return concat(
    nameBytes,
    writeU8(clTypeTag),
    writeU32(valueBytes.length),
    valueBytes,
  );
}

/** Serialize an AccountIdentifier */
function serializeAccountIdentifier(id: AccountIdentifier): Uint8Array {
  if ('AccountHash' in id) {
    // Variant 0: AccountHash (32 bytes)
    return concat(writeU8(0), writeHash(id.AccountHash));
  } else {
    // Variant 1: PublicKey
    return concat(writeU8(1), writePublicKey(id.PublicKey));
  }
}

// ── Deploy hash computation ────────────────────────────────────────

/**
 * Compute the deploy hash: blake2b256(header_bytes || payment_bytes || session_bytes)
 */
export function computeDeployHash(
  headerBytes: Uint8Array,
  paymentBytes: Uint8Array,
  sessionBytes: Uint8Array,
): Uint8Array {
  const hash = createHash('blake2b256');
  hash.update(headerBytes);
  hash.update(paymentBytes);
  hash.update(sessionBytes);
  return new Uint8Array(hash.digest());
}

// ── Public API: Build a complete deploy for a transfer ─────────────

export interface BuildTransferDeployParams {
  fromPublicKey: HexString;
  toPublicKey: HexString;
  amountMotes: bigint | string;
  chainName: string;
  gasPrice?: bigint;
  ttlMs?: number;
  paymentAmount?: bigint | string;
  transferId?: number | null;
}

export interface BuiltDeploy {
  deploy: Deploy;
  headerBytes: Uint8Array;
  paymentBytes: Uint8Array;
  sessionBytes: Uint8Array;
  deployHashBytes: Uint8Array;
}

/**
 * Build an unsigned transfer deploy.
 * Returns the deploy object plus raw bytes needed for signing.
 */
export function buildTransferDeploy(params: BuildTransferDeployParams): BuiltDeploy {
  const gasPrice = params.gasPrice?.toString() ?? '1';
  const ttlMs = params.ttlMs ?? 1800000; // 30 min default
  const paymentAmount = params.paymentAmount?.toString() ?? '100000000'; // 0.1 CSPR default gas
  const transferId = params.transferId ?? null;

  const timestamp = new Date().toISOString();

  // Build session first (we need it for body_hash)
  const session: { Transfer: TransferArgs } = {
    Transfer: {
      amount: params.amountMotes.toString(),
      target: { PublicKey: params.toPublicKey },
      id: transferId,
      transfer_id: null,
    },
  };

  // Serialize payment and session to compute body_hash
  const paymentBytes = serializePayment(paymentAmount);
  const sessionBytes = serializeTransfer(session.Transfer);

  // Body hash = blake2b256(payment_bytes || session_bytes)
  const bodyHash = createHash('blake2b256');
  bodyHash.update(paymentBytes);
  bodyHash.update(sessionBytes);
  const bodyHashHex = '0x' + bodyHash.digest('hex');

  // Build header
  const header: DeployHeader = {
    account: params.fromPublicKey,
    timestamp,
    ttl: `${ttlMs}ms`,
    gas_price: gasPrice,
    body_hash: bodyHashHex,
    dependencies: [],
    chain_name: params.chainName,
  };

  // Serialize header
  const headerBytes = serializeHeader(header);

  // Compute deploy hash
  const deployHashBytes = computeDeployHash(headerBytes, paymentBytes, sessionBytes);
  const deployHashHex = '0x' + Buffer.from(deployHashBytes).toString('hex');

  const deploy: Deploy = {
    hash: deployHashHex,
    header,
    payment: { StandardPayment: paymentAmount },
    session,
    approvals: [], // Will be filled after signing
  };

  return {
    deploy,
    headerBytes,
    paymentBytes,
    sessionBytes,
    deployHashBytes,
  };
}

/**
 * Create a signed deploy by adding the approval.
 */
export function createSignedDeploy(
  builtDeploy: BuiltDeploy,
  signerPublicKeyHex: HexString,
  signatureBytes: Uint8Array,
): Deploy {
  const approval: Approval = {
    signer: signerPublicKeyHex,
    signature: '0x' + Buffer.from(signatureBytes).toString('hex'),
  };

  return {
    ...builtDeploy.deploy,
    approvals: [approval],
  };
}