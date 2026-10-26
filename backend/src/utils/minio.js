/**
 * minio.js — MinIO client singleton + bucket-bootstrap helper.
 *
 * Import `minioClient` anywhere you need S3-compatible object storage,
 * and call `ensureBucket()` once at startup.
 */

const Minio = require('minio');

// ── Configuration (driven by .env) ─────────────────────────────────────────
const MINIO_ENDPOINT     = process.env.MINIO_ENDPOINT      || 'minio';
const MINIO_PORT         = parseInt(process.env.MINIO_PORT_INTERNAL || '9000', 10);
const MINIO_USE_SSL      = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY   = process.env.MINIO_ROOT_USER     || 'minioadmin';
const MINIO_SECRET_KEY   = process.env.MINIO_ROOT_PASSWORD || 'minioadmin';
const MINIO_BUCKET       = process.env.MINIO_BUCKET        || 'brandguard';

// ── Singleton client ────────────────────────────────────────────────────────
const minioClient = new Minio.Client({
  endPoint:  MINIO_ENDPOINT,
  port:      MINIO_PORT,
  useSSL:    MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

/**
 * Ensures the default bucket exists, creating it when absent.
 * Safe to call multiple times — idempotent.
 *
 * @param {string} [bucket] - Bucket name; defaults to MINIO_BUCKET env var.
 * @param {string} [region] - AWS-style region tag (cosmetic for MinIO).
 * @returns {Promise<void>}
 */
async function ensureBucket(bucket = MINIO_BUCKET, region = 'us-east-1') {
  try {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket, region);
      console.log(`[MinIO] Bucket "${bucket}" created.`);
    } else {
      console.log(`[MinIO] Bucket "${bucket}" already exists.`);
    }
  } catch (err) {
    console.error('[MinIO] Failed to ensure bucket:', err.message);
    throw err; // bubble up so server.js can abort startup on fatal error
  }
}

/**
 * Uploads a Buffer or stream to MinIO.
 *
 * @param {string} objectName   - Key path inside the bucket (e.g. "uploads/uuid.pdf").
 * @param {Buffer|stream.Readable} data
 * @param {number} size         - Byte length (-1 for unknown streams).
 * @param {string} [contentType]
 * @param {string} [bucket]
 * @returns {Promise<Minio.UploadedObjectInfo>}
 */
async function uploadObject(objectName, data, size = -1, contentType = 'application/octet-stream', bucket = MINIO_BUCKET) {
  const metadata = { 'Content-Type': contentType };
  return minioClient.putObject(bucket, objectName, data, size, metadata);
}

/**
 * Returns a presigned GET URL valid for `expirySeconds` (default 1 hour).
 *
 * @param {string} objectName
 * @param {number} [expirySeconds]
 * @param {string} [bucket]
 * @returns {Promise<string>}
 */
async function getPresignedUrl(objectName, expirySeconds = 3600, bucket = MINIO_BUCKET) {
  return minioClient.presignedGetObject(bucket, objectName, expirySeconds);
}

/**
 * Deletes an object from MinIO. No-op if the object doesn't exist.
 *
 * @param {string} objectName
 * @param {string} [bucket]
 * @returns {Promise<void>}
 */
async function deleteObject(objectName, bucket = MINIO_BUCKET) {
  await minioClient.removeObject(bucket, objectName);
}

module.exports = {
  minioClient,
  MINIO_BUCKET,
  ensureBucket,
  uploadObject,
  getPresignedUrl,
  deleteObject,
};
