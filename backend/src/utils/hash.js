/**
 * hash.js — Cryptographic hashing and verification utilities.
 *
 * Implements FR-DS-04 & FR-AP-04:
 * Computes SHA-256 hashes of draft version content and passport entries
 * to detect any tampering or unauthorized modifications.
 */

const crypto = require('crypto');

/**
 * Computes a SHA-256 hex digest of the given input.
 *
 * @param {string|Buffer} input - String or Buffer to hash
 * @returns {string} 64-character SHA-256 hexadecimal string
 */
function sha256(input) {
  if (input === null || input === undefined) {
    throw new TypeError('Cannot compute SHA-256 hash of null or undefined.');
  }

  const hash = crypto.createHash('sha256');

  if (Buffer.isBuffer(input)) {
    hash.update(input);
  } else if (typeof input === 'string') {
    hash.update(input, 'utf8');
  } else {
    // Coerce objects or numbers to string
    hash.update(String(input), 'utf8');
  }

  return hash.digest('hex');
}

/**
 * Verifies if the given input matches the expected SHA-256 hash.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * @param {string|Buffer} input
 * @param {string} expectedHash
 * @returns {boolean} True if the hash matches, false otherwise
 */
function verifyHash(input, expectedHash) {
  if (!expectedHash || typeof expectedHash !== 'string' || expectedHash.length !== 64) {
    return false;
  }

  try {
    const computed = sha256(input);
    const computedBuf = Buffer.from(computed, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');

    if (computedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuf, expectedBuf);
  } catch (_err) {
    return false;
  }
}

module.exports = {
  sha256,
  verifyHash,
};
