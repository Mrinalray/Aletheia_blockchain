/* ================================================================
   ALETHEIA — services/hashService.js
   Media fingerprinting for the blockchain authenticity layer.

   SHA-256  = exact cryptographic integrity (required, always computed)
   pHash    = visual similarity signal (optional, best-effort only)

   Neither of these replace the existing AI/forensic detection — they
   only fingerprint whatever bytes ALETHEIA already analysed, so the
   blockchain layer has something stable to register/verify against.
   ================================================================ */

const crypto = require('crypto');

/**
 * SHA-256 hash of the exact media bytes that were analysed.
 * Always available — this is the required, load-bearing hash.
 * Returns a 0x-prefixed 32-byte hex string (bytes32-compatible for ethers.js).
 */
function sha256Hex(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return `0x${hash}`;
}

/**
 * Best-effort perceptual hash (average hash / aHash) for images only.
 * Uses `sharp` if it is installed; if it isn't (or the buffer isn't a
 * decodable image, e.g. audio/video), this silently returns null rather
 * than breaking analysis or registration. pHash is a similarity signal,
 * never a substitute for the SHA-256 integrity hash.
 */
async function perceptualHash(buffer, mimeType) {
  if (!mimeType || !mimeType.startsWith('image/')) return null;

  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return null; // optional dependency not installed — skip quietly
  }

  try {
    const size = 8; // 8x8 -> 64-bit hash
    const { data } = await sharp(buffer)
      .grayscale()
      .resize(size, size, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    let bits = '';
    for (const v of data) bits += v >= avg ? '1' : '0';

    // Pack the 64-bit string into hex for compact storage/display.
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return `p${hex}`;
  } catch (err) {
    console.warn('[hashService] pHash skipped:', err.message);
    return null;
  }
}

/**
 * Hamming distance between two perceptual hashes (lower = more similar).
 * Returns null if either hash is missing or malformed.
 */
function pHashDistance(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return null;
  let distance = 0;
  for (let i = 1; i < hashA.length; i++) {
    const a = parseInt(hashA[i], 16);
    const b = parseInt(hashB[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    distance += (a ^ b).toString(2).split('1').length - 1;
  }
  return distance;
}

/**
 * Optional hash of the full forensic report (JSON-stringified) so the
 * on-chain record can reference the detailed off-chain report without
 * ever storing it. Returns a bytes32-compatible hex string.
 */
function reportHashOf(reportObject) {
  if (!reportObject) return '0x' + '0'.repeat(64);
  const json = JSON.stringify(reportObject);
  return sha256Hex(Buffer.from(json, 'utf8'));
}

module.exports = { sha256Hex, perceptualHash, pHashDistance, reportHashOf };
