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

  static forbidden(message = 'Forbidden: insufficient permissions.', code = 'FORBIDDEN', details = null) {
    return new AppError(message, 403, code, details);
  }

  static notFound(message = 'Resource not found.', code = 'NOT_FOUND', details = null) {
    return new AppError(message, 404, code, details);
  }

  static validationError(message = 'Validation failed.', details = null, code = 'VALIDATION_ERROR') {
    return new AppError(message, 422, code, details);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable.', code = 'SERVICE_UNAVAILABLE', details = null) {
    return new AppError(message, 503, code, details);
  }

  static timeout(message = 'Request timed out.', code = 'ML_TIMEOUT', details = null) {
    return new AppError(message, 503, code, details);
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
 * into a consistent JSON response and strips out stack traces.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred.';
  let details = err.details || null;

  // 1. Mongoose Schema Validation Error -> 422
  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Schema validation failed.';
    details = Object.keys(err.errors).reduce((acc, key) => {
      acc[key] = err.errors[key].message;
      return acc;
    }, {});
  }

  // 2. Mongoose Invalid ObjectId (CastError) -> 400
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid ID format for parameter "${err.path}".`;
  }

  // 3. JWT Authentication Errors -> 401
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid or malformed authentication token.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Authentication token has expired. Please sign in again.';
  }

  // 4. Multer Upload Errors -> 400
  if (err.name === 'MulterError') {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      code = 'FILE_TOO_LARGE';
      message = 'Uploaded file exceeds the maximum allowed size limit.';
    } else {
      code = 'UPLOAD_ERROR';
      message = `File upload error: ${err.message}`;
    }
  }

  // 5. JSON Parse / Syntax Error in request body -> 400
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body in request.';
  }

  // 6. ML Service Timeout or Connection Refused -> 503
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ML_TIMEOUT') {
    statusCode = 503;
    code = err.code === 'ML_TIMEOUT' ? 'ML_TIMEOUT' : 'SERVICE_UNAVAILABLE';
    message = 'ML service is currently unavailable or timed out.';
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

  const responseBody = {
    success: false,
    error: message,
    code,
  };

  if (details) {
    responseBody.details = details;
  }

  return res.status(statusCode).json(responseBody);
}

module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
};
