/**
 * uploadScan.js — Upload scanning and validation middleware.
 *
 * Enforces:
 *   1. File-type allow-list (.pdf, .docx, .md, .markdown)
 *   2. File size cap of 10 MB (10 * 1024 * 1024 bytes)
 *   3. Anti-virus (AV) scan stub before proceeding to storage/parsing
 *
 * Uses Multer memoryStorage so files remain in-memory buffers for
 * immediate scanning and direct streaming to MinIO.
 */

const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown'];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/markdown',
  'text/plain',
  'text/x-markdown',
  'application/octet-stream',
];

// Standard EICAR anti-virus test file signature (first 68 chars)
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Validates file extension and mime type.
 *
 * @param {string} originalname
 * @param {string} mimetype
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFileType(originalname, mimetype) {
  if (!originalname) {
    return { valid: false, error: 'File name is missing.' };
  }

  const ext = path.extname(originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `File type "${ext || 'unknown'}" is not permitted. Allowed formats: PDF (.pdf), DOCX (.docx), Markdown (.md).`,
    };
  }

  if (mimetype && !ALLOWED_MIME_TYPES.includes(mimetype) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `MIME type "${mimetype}" is not permitted.`,
    };
  }

  return { valid: true };
}

/**
 * Anti-virus scan stub.
 * In production, this can connect to ClamAV / VirusTotal / AWS GuardDuty.
 * Currently inspects byte buffer for malicious test signatures (e.g. EICAR).
 *
 * @param {Buffer} buffer
 * @param {string} originalname
 * @returns {Promise<boolean>}
 */
async function performAvScan(buffer, originalname = '') {
  if (!buffer || buffer.length === 0) {
    return true;
  }

  // Inspect up to first 4KB for test malware signatures
  const header = buffer.toString('utf-8', 0, Math.min(buffer.length, 4096));
  if (header.includes(EICAR_SIGNATURE)) {
    throw new Error('Malicious content detected: AV scan rejected file.');
  }

  return true;
}

// Multer memory-storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const check = validateFileType(file.originalname, file.mimetype);
    if (!check.valid) {
      const err = new Error(check.error);
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    return cb(null, true);
  },
}).single('file');

/**
 * uploadScan — Express middleware for upload verification.
 */
function uploadScan(req, res, next) {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File size exceeds 10 MB limit.',
          code: 'FILE_TOO_LARGE',
        });
      }
      return res.status(400).json({
        success: false,
        error: `Upload error: ${err.message}`,
        code: 'UPLOAD_ERROR',
      });
    } else if (err) {
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          success: false,
          error: err.message,
          code: 'INVALID_FILE_TYPE',
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload failed.',
        code: 'UPLOAD_ERROR',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded. A source file (.pdf, .docx, .md) is required.',
        code: 'MISSING_FILE',
      });
    }

    // Defensive check on size
    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 10 MB limit.',
        code: 'FILE_TOO_LARGE',
      });
    }

    // Secondary validation check
    const typeCheck = validateFileType(req.file.originalname, req.file.mimetype);
    if (!typeCheck.valid) {
      return res.status(400).json({
        success: false,
        error: typeCheck.error,
        code: 'INVALID_FILE_TYPE',
      });
    }

    // Anti-virus scan
    try {
      await performAvScan(req.file.buffer, req.file.originalname);
    } catch (avErr) {
      return res.status(400).json({
        success: false,
        error: avErr.message || 'Anti-virus scan rejected this file.',
        code: 'AV_SCAN_FAILED',
      });
    }

    return next();
  });
}

module.exports = {
  uploadScan,
  validateFileType,
  performAvScan,
  MAX_FILE_SIZE,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  EICAR_SIGNATURE,
};
