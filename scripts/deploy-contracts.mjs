#!/usr/bin/env node
// ── Deploy Escrow + Service Registry contracts to Casper Testnet ──
// Uses the same hand-rolled serialization as the Next.js app.
// Run: node /home/z/my-project/scripts/deploy-contracts.mjs

import { createHash, generateKeyPairSync, createPrivateKey, sign } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Constants ──
const TESTNET_RPC = 'https://node.testnet.casper.network/rpc';
const CHAIN_NAME = 'casper-test';
const MOTES_PER_CSPR = 1_000_000_000n;
const GAS_PRICE = 1n;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const STANDARD_PAYMENT = '5000000000'; // 5 CSPR for contract deploy
// Casper testnet faucet is now web-only (CSPR.live) or Discord bot.
// This script will attempt the faucet but requires manual funding if it fails.
const FAUCET_URLS = [
  'https://faucet.testnet.casper.network/api/v1/faucet',
  'https://testnet-faucet.casper.network/api/v1/faucet',
];

let rpcId = 0;

// ── Binary Helpers ──
function concat(...arrays) {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(totalLen);
  let off = 0;
  for (const a of arrays) { r.set(a, off); off += a.length; }
  return r;
}

function writeU8(v) { return new Uint8Array([v & 0xff]); }
function writeU32(v) { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); return new Uint8Array(b); }
function writeU64(v) { const b = new ArrayBuffer(8); new DataView(b).setBigUint64(0, BigInt(v), true); return new Uint8Array(b); }
function writeU512(val) {
  const n = BigInt(val);
  if (n === 0n) return concat(writeU32(0));
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return concat(writeU32(bytes.length), bytes);
}

function writeHash(hex) {
  const c = hex.replace(/^0x/, '');
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  return b;
}

function writeString(val) {
  const enc = new TextEncoder().encode(val);
  return concat(writeU32(enc.length), enc);
}

function writePublicKey(hex) {
  const c = hex.replace(/^0x/, '');
  const raw = c.length === 66 ? c.slice(2) : c;
  const b = new Uint8Array(33);
  b[0] = 0x01;
  for (let i = 0; i < 32; i++) b[i + 1] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return b;
}

// ── RPC ──
async function rpcCall(method, params = []) {
  const resp = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
  return data.result;
}

async function getStateRootHash() {
  const r = await rpcCall('chain_get_state_root_hash');
  return r.state_root_hash;
}

async function putDeploy(deployJson) {
  const resp = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'account_put_deploy', params: [deployJson] }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`Deploy failed: ${data.error.message}`);
  return data.result?.deploy_hash ?? 'unknown';
}

async function getDeployStatus(deployHash, timeoutMs = 120000, pollMs = 4000) {
  const start = Date.now();
  const clean = deployHash.replace(/^0x/, '');
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await rpcCall('info_get_deploy', [clean]);
      if (r.execution_results?.length > 0) {
        const er = r.execution_results[0].result;
        if (er.Success) {
          return { status: 'confirmed', blockHash: r.execution_results[0].block_hash, cost: er.Success.cost };
        }
        if (er.Failure) {
          return { status: 'failed', errorMessage: er.Failure.error_message, cost: er.Failure.cost };
        }
      }
    } catch { /* not found yet */ }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { status: 'pending' };
}

async function getAccountBalance(pubKeyHex) {
  const srh = await getStateRootHash();
  const clean = pubKeyHex.replace(/^0x/, '');
  const rawHex = clean.length === 66 ? clean.slice(2) : clean;
  const pubBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) pubBytes[i] = parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
  const h = createHash('blake2b512').update(pubBytes).digest().slice(0, 32);
  const accHashHex = Buffer.from(h).toString('hex');

  try {
    const accResp = await rpcCall('query_global_state', [
      { StateRootHash: srh },
      `account-hash-${accHashHex}`,
      [],
    ]);
    const mainPurse = accResp.stored_value?.Account?.main_purse;
    if (!mainPurse) return '0';

    const balResp = await rpcCall('query_global_state', [
      { StateRootHash: srh },
      mainPurse,
      [],
    ]);
    return balResp.stored_value?.balance ?? '0';
  } catch {
    return '0';
  }
}

async function requestFaucet(pubKeyHex) {
  const clean = pubKeyHex.replace(/^0x/, '');
  const casperKey = clean.length === 66 ? clean : `01${clean}`;
  console.log(`  Requesting faucet funds for ${casperKey.slice(0, 20)}...`);
  for (const url of FAUCET_URLS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_key: casperKey, amount: '50000000000' }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        console.log(`  Faucet OK (${url}): ${data.message || 'Transfer submitted'}`);
        return true;
      }
    } catch (e) {
      // Try next URL
    }
  }
  console.log('  All faucet endpoints failed (web-only faucet).');
  return false;
}

// ── Key Management ──
function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
  const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubBytes = new Uint8Array(pubRaw).slice(-32);
  const privBytes = new Uint8Array(privRaw).slice(-32);
  return { publicKey: pubBytes, privateKey: privBytes };
}

function getPublicKeyHex(pubBytes) {
  return `0x${Buffer.from(pubBytes).toString('hex')}`;
}

function getCasperPublicKeyHex(pubKeyHex) {
  const clean = pubKeyHex.replace(/^0x/, '');
  return `01${clean}`;
}

function signDeployHash(hashBytes, privKeyBytes) {
  const oid = Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]);
  const innerSeq = Buffer.concat([Buffer.from([0x30, oid.length + 2]), oid, Buffer.from([0x05, 0x00])]);
  const octet = Buffer.concat([
    Buffer.from([0x04, 0x22, 0x04, 0x20]),
    privKeyBytes,
  ]);
  const derKey = Buffer.concat([Buffer.from([0x30, innerSeq.length + octet.length]), innerSeq, octet]);
  const privKey = createPrivateKey({ key: derKey, format: 'der', type: 'pkcs8' });
  return new Uint8Array(sign(null, hashBytes, privKey));
}

// ── Wasm Deploy Serialization ──
function serializeWasmDeploySession(wasmBytes, entryPoint = 'call', args = []) {
  const argsParts = [];
  for (const arg of args) {
    argsParts.push(serializeNamedArg(arg));
  }
  const argsBytes = concat(...argsParts);

  return concat(
    writeU8(0), // ModuleBytes variant
    writeU32(wasmBytes.length),
    wasmBytes,
    writeU32(entryPoint.length),
    new TextEncoder().encode(entryPoint),
    writeU32(args.length),
    argsBytes,
  );
}

function serializeNamedArg({ name, clType, value }) {
  const nameBytes = writeString(name);
  const valueBytes = serializeCLValue(clType, value);
  return concat(nameBytes, writeU8(clTypeTag(clType)), writeU32(valueBytes.length), valueBytes);
}

function clTypeTag(type) {
  const tags = { String: 16, U64: 5, U128: 6, U256: 7, U512: 8, Bool: 1, U8: 3, I32: 10, Unit: 0, PublicKey: 18, Key: 19, Option: 20 };
  return tags[type] ?? 0;
}

function serializeCLValue(type, value) {
  switch (type) {
    case 'String': return writeString(value);
    case 'U64': return writeU64(BigInt(value));
    case 'U512': return writeU512(value);
    case 'Bool': return writeU8(value ? 1 : 0);
    case 'U8': return writeU8(value);
    case 'Unit': return new Uint8Array(0);
    default: return writeString(String(value));
  }
}

function buildWasmDeploy(params) {
  const { wasmBytes, fromPublicKey, chainName, entryPoint = 'call', args = [], gasPrice = GAS_PRICE, ttlMs = DEFAULT_TTL_MS, paymentAmount = STANDARD_PAYMENT } = params;

  const timestamp = new Date().toISOString();
  const paymentBytes = concat(writeU8(0), writeU512(paymentAmount));
  const sessionBytes = serializeWasmDeploySession(wasmBytes, entryPoint, args);

  const bh = createHash('blake2b256');
  bh.update(paymentBytes);
  bh.update(sessionBytes);
  const bodyHashHex = '0x' + bh.digest('hex');

  const header = {
    account: getCasperPublicKeyHex(fromPublicKey),
    timestamp,
    ttl: `${ttlMs}ms`,
    gas_price: gasPrice.toString(),
    body_hash: bodyHashHex,
    dependencies: [],
    chain_name: chainName,
  };

  const pkClean = header.account.replace(/^0x/, '');
  const rawHex = pkClean.length === 66 ? pkClean.slice(2) : pkClean;
  const pkBytes = new Uint8Array(33);
  pkBytes[0] = 0x01;
  for (let i = 0; i < 32; i++) pkBytes[i + 1] = parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
  const chainBytes = new TextEncoder().encode(chainName);

  const headerBytes = concat(
    pkBytes,
    writeU64(BigInt(new Date(timestamp).getTime())),
    writeU64(BigInt(ttlMs)),
    writeU512(gasPrice),
    writeHash(bodyHashHex),
    writeU32(0),
    writeU32(chainBytes.length),
    chainBytes,
  );

  const dh = createHash('blake2b256');
  dh.update(headerBytes);
  dh.update(paymentBytes);
  dh.update(sessionBytes);
  const deployHashBytes = new Uint8Array(dh.digest());
  const deployHashHex = '0x' + Buffer.from(deployHashBytes).toString('hex');

  const deploy = {
    hash: deployHashHex,
    header,
    payment: { StandardPayment: paymentAmount },
    session: {
      ModuleBytes: {
        module_bytes: `0x${Buffer.from(wasmBytes).toString('hex')}`,
        args: args.reduce((obj, arg) => {
          if (arg.clType === 'U64') obj[arg.name] = (BigInt(arg.value)).toString();
          else if (arg.clType === 'Bool') obj[arg.name] = arg.value;
          else obj[arg.name] = arg.value;
          return obj;
        }, {}),
      },
    },
    approvals: [],
  };

  return { deploy, deployHashBytes };
}

// ── Main ──
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AgentPay-x402 Contract Deployment to Casper Testnet    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // 1. Generate deployment keypair
  console.log('[1/7] Generating Ed25519 deployment keypair...');
  const kp = generateKeyPair();
  const pubKeyHex = getPublicKeyHex(kp.publicKey);
  const casperPubKey = getCasperPublicKeyHex(pubKeyHex);
  console.log(`  Public Key: ${casperPubKey.slice(0, 20)}...${casperPubKey.slice(-10)}`);

  // Save keypair to file
  const repoDir = join(__dirname, '..', 'agentpay-repo');
  const keyFile = join(repoDir, '.deploy-key.json');
  const keyData = {
    publicKeyHex: pubKeyHex,
    casperPublicKey: casperPubKey,
    privateKeyHex: Buffer.from(kp.privateKey).toString('hex'),
    timestamp: new Date().toISOString(),
  };
  writeFileSync(keyFile, JSON.stringify(keyData, null, 2));
  console.log(`  Keypair saved to ${keyFile}`);

  // 2. Check/get chain info
  console.log('\n[2/7] Connecting to Casper Testnet...');
  try {
    const status = await rpcCall('info_get_status');
    console.log(`  Chain: ${status.chainspec_name}`);
    console.log(`  Block Height: ${status.last_added_block_info?.height ?? 'unknown'}`);
    console.log(`  Protocol: ${status.protocol_version}`);
  } catch (e) {
    console.error(`  Failed to connect to testnet: ${e.message}`);
    console.error('  Aborting deployment.');
    process.exit(1);
  }

  // 3. Check if using existing funded key or need faucet
  const existingKey = process.env.DEPLOY_KEY_HEX;
  const existingPub = process.env.DEPLOY_PUB_KEY_HEX;
  let usePubKeyHex = pubKeyHex;
  let usePrivKey = kp.privateKey;

  if (existingKey && existingPub) {
    console.log('\n[3/7] Using pre-funded key from DEPLOY_PUB_KEY_HEX env...');
    usePubKeyHex = existingPub;
    usePrivKey = Buffer.from(existingKey, 'hex');
  } else {
    console.log('\n[3/7] Requesting testnet CSPR from faucet...');
    const faucetOk = await requestFaucet(casperPubKey);
    if (!faucetOk) {
      console.log('  Faucet is web-only. Fund this key manually:');
      console.log(`  Public Key: ${casperPubKey}`);
      console.log(`  Visit: https://testnet.cspr.live/faucet`);
      console.log('  Then re-run with: DEPLOY_PUB_KEY_HEX=... DEPLOY_KEY_HEX=... node deploy-contracts.mjs');
    }
  }

  // Wait for faucet transfer to land
  console.log('  Waiting 15s for faucet transfer to confirm...');
  await new Promise(r => setTimeout(r, 15000));

  // 4. Check balance
  console.log('\n[4/7] Checking account balance...');
  const checkPub = getCasperPublicKeyHex(usePubKeyHex);
  let balanceMotes = await getAccountBalance(checkPub);
  let balanceCSPR = Number(BigInt(balanceMotes)) / Number(MOTES_PER_CSPR);
  console.log(`  Balance: ${balanceCSPR.toFixed(4)} CSPR (${balanceMotes} motes)`);

  if (BigInt(balanceMotes) < 10_000_000_000n) {
    console.log('  Balance too low for deployment (need >= 10 CSPR).');
    console.log(`  Fund this key manually at https://testnet.cspr.live/faucet`);
    console.log(`  Public Key: ${checkPub}`);
    console.log(`  Then re-run: DEPLOY_PUB_KEY_HEX="${usePubKeyHex}" DEPLOY_KEY_HEX="${Buffer.from(usePrivKey).toString('hex')}" node deploy-contracts.mjs`);
    console.error('\n  Aborting. Account not funded.');
    process.exit(1);
  }

  // 5. Load Wasm files
  console.log('\n[5/7] Loading compiled Wasm contracts...');
  const escrowWasmPath = join(repoDir, 'contracts', 'target', 'wasm', 'escrow.wasm');
  const registryWasmPath = join(repoDir, 'contracts', 'target', 'wasm', 'service_registry.wasm');

  if (!existsSync(escrowWasmPath)) {
    console.error(`  Escrow Wasm not found at ${escrowWasmPath}`);
    process.exit(1);
  }
  if (!existsSync(registryWasmPath)) {
    console.error(`  Service Registry Wasm not found at ${registryWasmPath}`);
    process.exit(1);
  }

  const escrowWasm = new Uint8Array(readFileSync(escrowWasmPath));
  const registryWasm = new Uint8Array(readFileSync(registryWasmPath));
  console.log(`  Escrow Wasm: ${(escrowWasm.length / 1024).toFixed(1)} KB`);
  console.log(`  Service Registry Wasm: ${(registryWasm.length / 1024).toFixed(1)} KB`);

  // 6. Deploy escrow contract
  console.log('\n[6/7] Deploying Escrow contract...');
  const escrowBuilt = buildWasmDeploy({
    wasmBytes: escrowWasm,
    fromPublicKey: usePubKeyHex,
    chainName: CHAIN_NAME,
    entryPoint: 'call',
    args: [],
    paymentAmount: '5000000000', // 5 CSPR
  });

  const deployerCasperPub = getCasperPublicKeyHex(usePubKeyHex);
  const escrowSig = signDeployHash(escrowBuilt.deployHashBytes, usePrivKey);
  const escrowDeploy = {
    ...escrowBuilt.deploy,
    approvals: [{ signer: deployerCasperPub, signature: '0x' + Buffer.from(escrowSig).toString('hex') }],
  };

  console.log(`  Deploy hash: ${escrowBuilt.deploy.hash}`);
  console.log('  Submitting to network...');
  const escrowDeployHash = await putDeploy(escrowDeploy);
  console.log(`  Submitted! Waiting for confirmation (up to 2min)...`);

  const escrowResult = await getDeployStatus(escrowBuilt.deploy.hash, 120000);
  console.log(`  Status: ${escrowResult.status}`);
  if (escrowResult.status === 'failed') {
    console.error(`  Error: ${escrowResult.errorMessage}`);
    console.error('  Skipping escrow. Attempting service-registry deploy...');
  }
  if (escrowResult.status === 'confirmed') {
    console.log(`  Block: ${escrowResult.blockHash}`);
    console.log(`  Cost: ${escrowResult.cost} motes`);
  }

  // 7. Deploy service-registry contract
  console.log('\n[7/7] Deploying Service Registry contract...');
  const registryBuilt = buildWasmDeploy({
    wasmBytes: registryWasm,
    fromPublicKey: usePubKeyHex,
    chainName: CHAIN_NAME,
    entryPoint: 'call',
    args: [],
    paymentAmount: '5000000000',
  });

  const registrySig = signDeployHash(registryBuilt.deployHashBytes, usePrivKey);
  const registryDeploy = {
    ...registryBuilt.deploy,
    approvals: [{ signer: deployerCasperPub, signature: '0x' + Buffer.from(registrySig).toString('hex') }],
  };

  console.log(`  Deploy hash: ${registryBuilt.deploy.hash}`);
  console.log('  Submitting to network...');
  const registryDeployHash = await putDeploy(registryDeploy);
  console.log(`  Submitted! Waiting for confirmation (up to 2min)...`);

  const registryResult = await getDeployStatus(registryBuilt.deploy.hash, 120000);
  console.log(`  Status: ${registryResult.status}`);
  if (registryResult.status === 'failed') {
    console.error(`  Error: ${registryResult.errorMessage}`);
  }
  if (registryResult.status === 'confirmed') {
    console.log(`  Block: ${registryResult.blockHash}`);
    console.log(`  Cost: ${registryResult.cost} motes`);
  }

  // ── Output results ──
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    DEPLOYMENT RESULTS                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  Deployer Public Key: ${deployerCasperPub}`);
  const pubBytesForHash = Buffer.from(usePubKeyHex.replace('0x', ''), 'hex');
  const accHash = createHash('blake2b512').update(pubBytesForHash).digest().slice(0, 32);
  console.log(`  Deployer Account Hash: account-hash-${Buffer.from(accHash).toString('hex')}`);
  console.log(`\n  Escrow Contract:`);
  console.log(`    Deploy Hash: ${escrowBuilt.deploy.hash}`);
  console.log(`    Status: ${escrowResult.status}`);
  if (escrowResult.status === 'failed') console.log(`    Error: ${escrowResult.errorMessage}`);
  console.log(`    Explorer: https://testnet.cspr.live/deploy/${escrowBuilt.deploy.hash.replace('0x', '')}`);

  console.log(`\n  Service Registry Contract:`);
  console.log(`    Deploy Hash: ${registryBuilt.deploy.hash}`);
  console.log(`    Status: ${registryResult.status}`);
  if (registryResult.status === 'failed') console.log(`    Error: ${registryResult.errorMessage}`);
  console.log(`    Explorer: https://testnet.cspr.live/deploy/${registryBuilt.deploy.hash.replace('0x', '')}`);

  // Save deployment results
  const deployResults = {
    deployer: {
      publicKeyHex: usePubKeyHex,
      casperPublicKey: deployerCasperPub,
      accountHash: `account-hash-${Buffer.from(accHash).toString('hex')}`,
      privateKeyHex: Buffer.from(usePrivKey).toString('hex'),
    },
    escrow: {
      deployHash: escrowBuilt.deploy.hash,
      status: escrowResult.status,
      blockHash: escrowResult.blockHash || null,
      error: escrowResult.errorMessage || null,
      explorerUrl: `https://testnet.cspr.live/deploy/${escrowBuilt.deploy.hash.replace('0x', '')}`,
    },
    serviceRegistry: {
      deployHash: registryBuilt.deploy.hash,
      status: registryResult.status,
      blockHash: registryResult.blockHash || null,
      error: registryResult.errorMessage || null,
      explorerUrl: `https://testnet.cspr.live/deploy/${registryBuilt.deploy.hash.replace('0x', '')}`,
    },
    timestamp: new Date().toISOString(),
    chainName: CHAIN_NAME,
    wasmSizes: {
      escrow: escrowWasm.length,
      serviceRegistry: registryWasm.length,
    },
  };

  const resultsFile = join(repoDir, '.deploy-results.json');
  writeFileSync(resultsFile, JSON.stringify(deployResults, null, 2));
  console.log(`\n  Results saved to: ${resultsFile}`);
  console.log(`  Keypair saved to: ${keyFile}`);
  console.log('\n  Next step: Query the deployed contracts for their contract hashes,');
  console.log('  then update src/lib/casper/constants.ts with the real hashes.');
}

main().catch(err => {
  console.error('\nDeployment failed:', err);
  process.exit(1);
});