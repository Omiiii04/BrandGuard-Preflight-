/**
 * hash.test.js — Unit tests for cryptographic hash utility (FR-DS-04).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sha256, verifyHash } = require('../src/utils/hash');

describe('Cryptographic Hash Utility (hash.js)', () => {
  it('computes correct SHA-256 hex digest for a string', () => {
    const text = 'BrandGuard Preflight Compliance Content';
    const hash = sha256(text);

    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);

    // Known SHA-256 test vector
    const emptyHash = sha256('');
    assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes identical SHA-256 for identical Buffer and UTF-8 string', () => {
    const content = 'Special promotional offer 50% discount with free returns.';
    const stringHash = sha256(content);
    const bufferHash = sha256(Buffer.from(content, 'utf-8'));

    assert.equal(stringHash, bufferHash);
  });

  it('throws TypeError when hashing null or undefined', () => {
    assert.throws(() => sha256(null), /TypeError/);
    assert.throws(() => sha256(undefined), /TypeError/);
  });

  it('verifies valid SHA-256 hash correctly using timingSafeEqual', () => {
    const content = 'Confidential marketing draft';
    const expectedHash = sha256(content);

    assert.equal(verifyHash(content, expectedHash), true);
    assert.equal(verifyHash(Buffer.from(content), expectedHash), true);
  });

  it('rejects altered content or corrupted hash', () => {
    const content = 'Original draft copy';
    const validHash = sha256(content);

    // Tampered content
    assert.equal(verifyHash('Tampered draft copy', validHash), false);

    // Corrupted hash
    const corruptedHash = '0'.repeat(64);
    assert.equal(verifyHash(content, corruptedHash), false);

    // Malformed hash formats
    assert.equal(verifyHash(content, 'short-hash'), false);
    assert.equal(verifyHash(content, null), false);
    assert.equal(verifyHash(content, ''), false);
  });
});
