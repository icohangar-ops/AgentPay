// ── Ed25519 Key Management ──────────────────────────────────────────
// Uses Node.js built-in crypto for Ed25519 key generation and signing.
// No external dependencies required.

import { createHash, generateKeyPairSync, createPrivateKey, randomBytes, sign } from 'crypto';
import { KEY_TAG_ED25519 } from './constants';
import type { Ed25519KeyPair, HexString } from './types';

/**
 * Generate a new Ed25519 keypair using Node.js crypto.
 * Returns the raw key bytes plus hex representations.
 */
export function generateKeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Export raw bytes
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
  const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

  // Extract the raw 32-byte key from DER encoding
  // SPKI for Ed25519: header + OID + 32 bytes (last 32 bytes are the key)
  const pubBytes = new Uint8Array(pubRaw).slice(-32);
  // PKCS8 for Ed25519: header + OID + 32 bytes (last 32 bytes are the key)
  const privBytes = new Uint8Array(privRaw).slice(-32);

  const publicKeyHex = toHex(pubBytes);
  const accountHash = computeAccountHash(pubBytes);

  return {
    privateKey: privBytes,
    publicKey: pubBytes,
    publicKeyHex: `0x${publicKeyHex}`,
    accountHash,
  };
}

/**
 * Sign a message (deploy hash bytes) with the Ed25519 private key.
 * Uses Node.js crypto.sign with Ed25519.
 */
export function signMessage(message: Uint8Array, privateKeyBytes: Uint8Array): Uint8Array {
  // Reconstruct a proper Ed25519 private key from raw bytes
  const privKey = createPrivateKey({
    key: createRawEd25519PrivateKey(privateKeyBytes),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = sign(null, message, privKey);
  return new Uint8Array(signature);
}

/**
 * Create a DER-encoded PKCS8 Ed25519 private key from raw 32 bytes.
 * Ed25519 PKCS8 structure:
 *   SEQUENCE { SEQUENCE { OID, NULL }, OCTET STRING { 32 bytes } }
 */
function createRawEd25519PrivateKey(rawKey: Uint8Array): Buffer {
  // Ed25519 OID: 1.3.101.112
  const oid = Buffer.from([
    0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, // OID sequence
  ]);

  // Inner SEQUENCE: { OID, NULL }
  const innerSeq = Buffer.concat([
    Buffer.from([0x30, oid.length + 2]), // SEQUENCE tag + length
    oid,
    Buffer.from([0x05, 0x00]), // NULL
  ]);

  // OCTET STRING wrapping the raw key
  const octetString = Buffer.concat([
    Buffer.from([0x04, 0x22]), // OCTET STRING tag + length (34 = 0x22)
    Buffer.from([0x04, 0x20]), // OCTET STRING tag + length (32)
    rawKey,
  ]);

  // Outer SEQUENCE
  return Buffer.concat([
    Buffer.from([0x30, innerSeq.length + octetString.length]),
    innerSeq,
    octetString,
  ]);
}

/**
 * Compute the Casper account hash from a public key.
 * In Casper, the account hash is blake2b(raw_key_bytes) with digest length 32.
 */
export function computeAccountHash(publicKeyBytes: Uint8Array): string {
  const hash = createHash('blake2b512')
    .update(publicKeyBytes)
    .digest();
  // Take first 32 bytes
  const accountHashBytes = hash.slice(0, 32);
  return `account-hash-${toHex(accountHashBytes)}`;
}

/**
 * Convert bytes to hex string (no prefix).
 */
export function toHex(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Convert hex string (with or without 0x prefix) to Uint8Array.
 */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Get the public key hex in Casper format (tag byte + raw key hex).
 * Used in deploy approval.signer and header.account fields.
 */
export function getPublicKeyCasperHex(publicKeyHex: HexString): string {
  const clean = publicKeyHex.replace(/^0x/, '');
  return `01${clean}`;
}

/**
 * Format a public key for display (truncated).
 */
export function formatPublicKey(pk: HexString): string {
  const clean = pk.replace(/^0x/, '');
  if (clean.length <= 16) return `0x${clean}`;
  return `0x${clean.slice(0, 8)}...${clean.slice(-8)}`;
}

/**
 * Generate a random hex string of given byte length.
 */
export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}