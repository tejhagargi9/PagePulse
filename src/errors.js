export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorBody(error, requestId) {
  const known = error instanceof AppError;
  return {
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'An unexpected error occurred',
      ...(known && error.details ? { details: error.details } : {}),
      requestId
    }
  };
}
