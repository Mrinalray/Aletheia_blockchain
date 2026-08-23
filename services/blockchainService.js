/* ================================================================
   ALETHEIA — services/blockchainService.js
   Decentralized Media Authenticity Verification Layer (SIH26204)

   IMPORTANT: this service never determines whether media is real or
   AI-generated. That verdict already comes from the existing
   SightEngine + Gemini pipeline in server.js. This module only
   creates/reads a tamper-evident on-chain record of that verdict,
   keyed by the media's SHA-256 fingerprint.

   Design goals:
   - If blockchain config is missing/broken, ALETHEIA's core AI
     detection must keep working normally (see server.js routes).
   - Never expose the private key or RPC/API secrets to the frontend.
   - Falls back to a clearly-labelled in-memory "Demo Blockchain Mode"
     when no real testnet config is present, so the feature is still
     demoable without real Sepolia ETH / Alchemy keys. Demo records are
     NEVER presented as real transactions.
   ================================================================ */

const path = require('path');
const abi = require('../contracts/AlethiaAuthenticityRegistry.abi.json');

const CONFIG = {
  RPC_URL:          process.env.BLOCKCHAIN_RPC_URL || '',
  PRIVATE_KEY:      process.env.BLOCKCHAIN_PRIVATE_KEY || '',
  CONTRACT_ADDRESS: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '',
  NETWORK:          process.env.BLOCKCHAIN_NETWORK || 'sepolia',
  ALCHEMY_API_KEY:  process.env.ALCHEMY_API_KEY || '',
};

function resolveRpcUrl() {
  if (CONFIG.RPC_URL) return CONFIG.RPC_URL;
  if (CONFIG.ALCHEMY_API_KEY) {
    return `https://eth-${CONFIG.NETWORK}.g.alchemy.com/v2/${CONFIG.ALCHEMY_API_KEY}`;
  }
  return '';
}

function isConfigured() {
  return Boolean(resolveRpcUrl() && CONFIG.PRIVATE_KEY && CONFIG.CONTRACT_ADDRESS);
}

/* ── ethers.js is an optional dependency until `npm install` is run
   with the updated package.json. Load it lazily so the rest of the
   backend (existing AI detection) keeps working even if it's missing. */
let ethersLib = null;
function loadEthers() {
  if (ethersLib) return ethersLib;
  try {
    ethersLib = require('ethers');
    return ethersLib;
  } catch {
    return null;
  }
}

let providerCache = null;
let contractCache = null;

function getProvider() {
  const ethers = loadEthers();
  if (!ethers) return null;
  if (providerCache) return providerCache;
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) return null;
  providerCache = new ethers.JsonRpcProvider(rpcUrl);
  return providerCache;
}

function getContract() {
  const ethers = loadEthers();
  if (!ethers) return null;
  if (contractCache) return contractCache;
  const provider = getProvider();
  if (!provider || !CONFIG.PRIVATE_KEY || !CONFIG.CONTRACT_ADDRESS) return null;

  try {
    const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
    contractCache = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi, wallet);
    return contractCache;
  } catch (err) {
    console.error('[blockchainService] Failed to init contract:', err.message);
    return null;
  }
}

/* ── DEMO MODE (in-memory) ───────────────────────────────────────
   Only used when real testnet config is absent. Clearly labelled
   everywhere it surfaces so it is never mistaken for a real chain. */
const demoStore = new Map(); // mediaHash -> record
const demoIdIndex = new Map(); // verificationId -> mediaHash
let demoTxCounter = 0;

function buildVerificationId(mediaHash) {
  const clean = mediaHash.replace(/^0x/, '');
  return `ALT-${clean.slice(0, 8).toUpperCase()}`;
}

function friendlyError(err) {
  const msg = (err && (err.shortMessage || err.reason || err.message)) || 'Unknown blockchain error';

  if (/already registered/i.test(msg)) return { code: 'DUPLICATE', message: 'This media is already registered on the blockchain.' };
  if (/verification id already in use/i.test(msg)) return { code: 'DUPLICATE_ID', message: 'Verification ID collision — please retry.' };
  if (/insufficient funds/i.test(msg)) return { code: 'INSUFFICIENT_FUNDS', message: 'Wallet has insufficient test ETH to pay gas on the configured network.' };
  if (/network.*mismatch|chain.?id/i.test(msg)) return { code: 'NETWORK_MISMATCH', message: 'RPC network does not match the configured blockchain network.' };
  if (/invalid contract address|bad address|resolver|ENS/i.test(msg)) return { code: 'INVALID_CONTRACT', message: 'Configured contract address is invalid or not deployed on this network.' };
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) return { code: 'RPC_TIMEOUT', message: 'Could not reach the blockchain RPC endpoint (timeout).' };
  if (/nonce/i.test(msg)) return { code: 'NONCE_ERROR', message: 'Transaction nonce conflict — please retry.' };
  if (/reverted|call revert/i.test(msg)) return { code: 'CONTRACT_REVERT', message: msg };

  return { code: 'UNKNOWN', message: msg };
}

/**
 * Returns overall blockchain subsystem status for the /api/blockchain/status
 * health endpoint and for the frontend to know whether it's talking to a
 * real testnet or demo mode.
 */
function getStatus() {
  const ethers = loadEthers();
  return {
    ethersInstalled: Boolean(ethers),
    configured: isConfigured(),
    demoMode: !isConfigured(),
    network: CONFIG.NETWORK,
    contractAddress: CONFIG.CONTRACT_ADDRESS || null,
    rpcConfigured: Boolean(resolveRpcUrl()),
  };
}

/**
 * Register a media record. Falls back to demo mode automatically when
 * real testnet config is missing — the caller always gets a consistent
 * response shape with a `demoMode` flag so the UI can label it correctly.
 */
async function registerMedia({ mediaHash, verdict, confidence, mediaType, modelVersion, reportHash }) {
  const verificationId = buildVerificationId(mediaHash);

  if (!isConfigured() || !loadEthers()) {
    if (demoStore.has(mediaHash)) {
      return { success: false, demoMode: true, error: { code: 'DUPLICATE', message: 'This media is already registered (Demo Blockchain Mode).' } };
    }
    demoTxCounter += 1;
    const record = {
      mediaHash, verificationId, verdict, confidence, mediaType,
      modelVersion, reportHash: reportHash || '0x' + '0'.repeat(64),
      timestamp: Math.floor(Date.now() / 1000),
      registeredBy: '0xDEMO0000000000000000000000000000000000',
      txHash: `0xdemo${demoTxCounter.toString(16).padStart(8, '0')}${'0'.repeat(50)}`.slice(0, 66),
      exists: true,
    };
    demoStore.set(mediaHash, record);
    demoIdIndex.set(verificationId, mediaHash);
    return { success: true, demoMode: true, verificationId, txHash: record.txHash, timestamp: record.timestamp };
  }

  const contract = getContract();
  if (!contract) {
    return { success: false, demoMode: false, error: { code: 'NOT_CONFIGURED', message: 'Blockchain service is not fully configured.' } };
  }

  try {
    const tx = await contract.registerMedia(
      mediaHash,
      verificationId,
      verdict,
      Math.round(confidence),
      mediaType,
      modelVersion,
      reportHash || ('0x' + '0'.repeat(64))
    );
    const receipt = await tx.wait();
    return {
      success: true,
      demoMode: false,
      verificationId,
      txHash: receipt.hash || tx.hash,
      blockNumber: receipt.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    console.error('[blockchainService] registerMedia failed:', err.message);
    return { success: false, demoMode: false, error: friendlyError(err) };
  }
}

async function isRegistered(mediaHash) {
  if (!isConfigured() || !loadEthers()) {
    return { demoMode: true, registered: demoStore.has(mediaHash) };
  }
  const contract = getContract();
  if (!contract) return { demoMode: false, registered: false, error: friendlyError({ message: 'Not configured' }) };

  try {
    const registered = await contract.verifyMedia(mediaHash);
    return { demoMode: false, registered };
  } catch (err) {
    return { demoMode: false, registered: false, error: friendlyError(err) };
  }
}

function serializeRecord(raw, demoMode) {
  if (!raw) return null;
  if (demoMode) return { ...raw, demoMode: true };
  return {
    mediaHash: raw.mediaHash,
    verificationId: raw.verificationId,
    verdict: raw.verdict,
    confidence: Number(raw.confidence),
    mediaType: raw.mediaType,
    modelVersion: raw.modelVersion,
    reportHash: raw.reportHash,
    timestamp: Number(raw.timestamp),
    registeredBy: raw.registeredBy,
    demoMode: false,
  };
}

async function getRecordByHash(mediaHash) {
  if (!isConfigured() || !loadEthers()) {
    const rec = demoStore.get(mediaHash) || null;
    return { record: rec ? serializeRecord(rec, true) : null, demoMode: true };
  }
  const contract = getContract();
  if (!contract) return { record: null, demoMode: false, error: friendlyError({ message: 'Not configured' }) };

  try {
    const raw = await contract.getMediaRecord(mediaHash);
    return { record: serializeRecord(raw, false), demoMode: false };
  } catch (err) {
    if (/no record for this hash/i.test(err.message || '')) return { record: null, demoMode: false };
    return { record: null, demoMode: false, error: friendlyError(err) };
  }
}

async function getRecordById(verificationId) {
  if (!isConfigured() || !loadEthers()) {
    const hash = demoIdIndex.get(verificationId);
    const rec = hash ? demoStore.get(hash) : null;
    return { record: rec ? serializeRecord(rec, true) : null, demoMode: true };
  }
  const contract = getContract();
  if (!contract) return { record: null, demoMode: false, error: friendlyError({ message: 'Not configured' }) };

  try {
    const raw = await contract.getRecordByVerificationId(verificationId);
    return { record: serializeRecord(raw, false), demoMode: false };
  } catch (err) {
    if (/unknown verification id/i.test(err.message || '')) return { record: null, demoMode: false };
    return { record: null, demoMode: false, error: friendlyError(err) };
  }
}

module.exports = {
  isConfigured,
  getStatus,
  buildVerificationId,
  registerMedia,
  isRegistered,
  getRecordByHash,
  getRecordById,
};
