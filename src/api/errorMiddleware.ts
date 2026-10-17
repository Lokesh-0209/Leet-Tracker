/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError, ERROR_CODES, isAppError, type ErrorContract } from '../domain/index.js';

export const ERROR_CODE_TO_HTTP_STATUS: Record<string, number> = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.ILLEGAL_TRANSITION]: 409,
  [ERROR_CODES.INVALID_USERNAME]: 422,
  [ERROR_CODES.PRIVATE_OR_EMPTY_PROFILE]: 422,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.NETWORK_ERROR]: 502,
  [ERROR_CODES.UPSTREAM_SCHEMA_CHANGED]: 502,
};

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (isAppError(err)) {
    const status = ERROR_CODE_TO_HTTP_STATUS[err.code] || 500;
    res.status(status).json(err.toJSON());
    return;
  }

  // Handle standard JSON parse errors from body-parser
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    const payload: ErrorContract = {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid JSON request payload.',
      retryable: false,
    };
    res.status(400).json(payload);
    return;
  }

  // Unknown internal error: return 500 without leaking server stack trace
  res.status(500).json({
    code: ERROR_CODES.NETWORK_ERROR,
    message: 'An unexpected internal error occurred.',
    retryable: false,
  });
}
