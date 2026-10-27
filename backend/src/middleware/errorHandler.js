/**
 * errorHandler.js — Centralized error handling middleware.
 *
 * Provides structured JSON responses for all error scenarios without leaking
 * stack traces into responses:
 *   - 400 Bad Request / Upload scan failures / Invalid ObjectIds
 *   - 401 Unauthorized / Invalid or expired JWT
 *   - 403 Forbidden / Role insufficiency
 *   - 404 Not Found (drafts, sources, findings)
 *   - 422 Unprocessable Entity / Schema validation failures
 *   - 503 Service Unavailable / ML timeout or downstream outages
 *   - 500 Internal Server Error
 *
 * Conforms to OpenAPI ErrorResponse specification:
 *   { success: false, error: string, code: string, details?: any }
 */

/**
 * Custom application operational error class.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {string} [code='INTERNAL_ERROR'] - Machine-readable error code
   * @param {any} [details=null] - Optional structured metadata or validation errors
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request.', code = 'BAD_REQUEST', details = null) {
    return new AppError(message, 400, code, details);
  }

  static unauthorized(message = 'Authentication required.', code = 'UNAUTHORIZED', details = null) {
    return new AppError(message, 401, code, details);
  }

  static invalidJwt(message = 'Invalid or expired authentication token.', code = 'INVALID_TOKEN', details = null) {
    return new AppError(message, 401, code, details);
  }

  static forbidden(message = 'Forbidden: insufficient permissions.', code = 'FORBIDDEN', details = null) {
    return new AppError(message, 403, code, details);
  }

  static forbiddenRole(message = 'Forbidden: user role has insufficient privileges.', code = 'ROLE_INSUFFICIENT', details = null) {
    return new AppError(message, 403, code, details);
  }

  static notFound(message = 'Resource not found.', code = 'NOT_FOUND', details = null) {
    return new AppError(message, 404, code, details);
  }

  static draftNotFound(id = null, message = null) {
    const msg = message || (id ? `Draft "${id}" was not found in your organisation.` : 'Draft not found in your organisation.');
    return new AppError(msg, 404, 'DRAFT_NOT_FOUND', id ? { draftId: id } : null);
  }

  static validationError(message = 'Schema validation failed.', details = null, code = 'VALIDATION_ERROR') {
    return new AppError(message, 422, code, details);
  }

  static schemaValidationFailure(message = 'Schema validation failed.', details = null) {
    return new AppError(message, 422, 'VALIDATION_ERROR', details);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable.', code = 'SERVICE_UNAVAILABLE', details = null) {
    return new AppError(message, 503, code, details);
  }

  static timeout(message = 'ML service timed out.', code = 'ML_TIMEOUT', details = null) {
    return new AppError(message, 503, code, details);
  }

  static mlTimeout(message = 'ML service timed out.', details = null) {
    return new AppError(message, 503, 'ML_TIMEOUT', details);
  }

  static uploadScanFailure(message = 'Upload scan validation failed.', code = 'UPLOAD_SCAN_FAILED', details = null) {
    return new AppError(message, 400, code, details);
  }
}

/**
 * 404 catch-all route handler.
 */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found.`,
    code: 'NOT_FOUND',
  });
}

/**
 * Global Express error handling middleware.
 *
 * Normalizes different error types (Mongoose, JWT, Multer, AppError, etc.)
 * into a consistent JSON response and strips out stack traces:
 *   - 401 Unauthorized / Invalid JWT
 *   - 403 Forbidden / Forbidden Role
 *   - 404 Not Found / Draft Not Found
 *   - 503 Service Unavailable / ML Timeout
 *   - 422 Unprocessable Entity / Schema Validation Failure
 *   - 400 Bad Request / Upload Scan Failure
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred.';
  let details = err.details || null;

  // 1. JWT Authentication Errors -> 401
  if (
    err.name === 'JsonWebTokenError' ||
    err.name === 'TokenExpiredError' ||
    err.name === 'NotBeforeError' ||
    code === 'INVALID_TOKEN' ||
    code === 'TOKEN_EXPIRED' ||
    code === 'TOKEN_NOT_ACTIVE' ||
    code === 'UNAUTHENTICATED' ||
    statusCode === 401
  ) {
    statusCode = 401;
    if (err.name === 'JsonWebTokenError') {
      code = 'INVALID_TOKEN';
      message = 'Invalid or malformed authentication token.';
    } else if (err.name === 'TokenExpiredError') {
      code = 'TOKEN_EXPIRED';
      message = 'Authentication token has expired. Please sign in again.';
    } else if (err.name === 'NotBeforeError') {
      code = 'TOKEN_NOT_ACTIVE';
      message = 'Authentication token is not yet active.';
    } else if (!code || code === 'INTERNAL_ERROR') {
      code = 'UNAUTHORIZED';
    }
  }

  // 2. Forbidden Role & Insufficient Privileges -> 403
  else if (
    code === 'ROLE_INSUFFICIENT' ||
    code === 'NO_ROLE_ASSIGNED' ||
    code === 'FORBIDDEN' ||
    statusCode === 403
  ) {
    statusCode = 403;
    if (!code || code === 'INTERNAL_ERROR') {
      code = 'FORBIDDEN';
    }
  }

  // 3. Draft Not Found & Resource Not Found -> 404
  else if (
    code === 'DRAFT_NOT_FOUND' ||
    code === 'NOT_FOUND' ||
    code === 'FINDING_NOT_FOUND' ||
    code === 'SOURCE_NOT_FOUND' ||
    code === 'COMMENT_NOT_FOUND' ||
    statusCode === 404
  ) {
    statusCode = 404;
    if (!code || code === 'INTERNAL_ERROR') {
      code = 'NOT_FOUND';
    }
  }

  // 4. ML Service Timeout or Connection Refused -> 503
  else if (
    code === 'ML_TIMEOUT' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ETIMEDOUT' ||
    code === 'SERVICE_UNAVAILABLE' ||
    err.name === 'TimeoutError' ||
    err.type === 'timeout' ||
    /ml.*time(d)?\s*out/i.test(err.message || '') ||
    statusCode === 503
  ) {
    statusCode = 503;
    code = (code === 'ML_TIMEOUT' || /ml/i.test(err.message || '')) ? 'ML_TIMEOUT' : 'SERVICE_UNAVAILABLE';
    message = err.message || 'ML service is currently unavailable or timed out.';
  }

  // 5. Schema Validation Failure (Mongoose or custom) -> 422
  else if (
    (err.name === 'ValidationError' && err.errors) ||
    code === 'VALIDATION_ERROR' ||
    code === 'SCHEMA_VALIDATION_FAILED' ||
    statusCode === 422
  ) {
    statusCode = 422;
    code = code && code !== 'INTERNAL_ERROR' ? code : 'VALIDATION_ERROR';
    if (err.name === 'ValidationError' && err.errors) {
      message = 'Schema validation failed.';
      details = Object.keys(err.errors).reduce((acc, key) => {
        acc[key] = err.errors[key].message;
        return acc;
      }, {});
    }
  }

  // 6. Upload Scan Failure, Multer Errors, Malformed JSON or Invalid IDs -> 400
  else if (
    code === 'UPLOAD_SCAN_FAILED' ||
    code === 'AV_SCAN_FAILED' ||
    code === 'VIRUS_DETECTED' ||
    code === 'INVALID_FILE_TYPE' ||
    code === 'FILE_TOO_LARGE' ||
    code === 'MISSING_FILE' ||
    code === 'UPLOAD_ERROR' ||
    err.name === 'MulterError' ||
    (err.name === 'CastError' && err.kind === 'ObjectId') ||
    (err instanceof SyntaxError && err.status === 400 && 'body' in err) ||
    statusCode === 400
  ) {
    statusCode = 400;
    if (err.name === 'MulterError') {
      if (err.code === 'LIMIT_FILE_SIZE') {
        code = 'FILE_TOO_LARGE';
        message = 'Uploaded file exceeds the maximum allowed size limit.';
      } else {
        code = 'UPLOAD_ERROR';
        message = `File upload error: ${err.message}`;
      }
    } else if (err.name === 'CastError' && err.kind === 'ObjectId') {
      code = 'INVALID_ID';
      message = `Invalid ID format for parameter "${err.path}".`;
    } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      code = 'INVALID_JSON';
      message = 'Malformed JSON body in request.';
    } else if (!code || code === 'INTERNAL_ERROR') {
      code = 'BAD_REQUEST';
    }
  }

  // Internal 500 error sanitization in production: hide raw error details
  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    message = 'An internal server error occurred.';
    code = 'INTERNAL_SERVER_ERROR';
    details = null;
  }

  // Log error internally (with stack trace for debugging), but never send stack trace to client
  if (statusCode >= 500) {
    console.error(`[errorHandler] ${statusCode} ${code}: ${err.message}`, err.stack || err);
  }

  // Strictly enforce structured format: { success: false, error: string, code: string, details?: any }
  // Never leak stack traces into the HTTP response under ANY circumstances
  const responseBody = {
    success: false,
    error: message,
    code,
  };

  if (details !== null && details !== undefined) {
    if (typeof details === 'object') {
      const cleanDetails = Array.isArray(details) ? [...details] : { ...details };
      delete cleanDetails.stack;
      delete cleanDetails.stackTrace;
      responseBody.details = cleanDetails;
    } else {
      responseBody.details = details;
    }
  }

  // Double guard: Ensure stack properties are never attached to responseBody
  delete responseBody.stack;
  delete responseBody.stackTrace;

  return res.status(statusCode).json(responseBody);
}

module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
};
