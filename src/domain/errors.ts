/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ERROR_CODES, type ErrorCode } from './constants.js';

export interface ErrorContract {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: unknown;
}

export class AppError extends Error implements ErrorContract {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(params: {
    code: ErrorCode;
    message: string;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.retryable = params.retryable ?? false;
    this.details = params.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): ErrorContract {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      retryable: false,
      details,
    });
    this.name = 'ValidationError';
  }
}

export class IllegalTransitionError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message,
      retryable: false,
      details,
    });
    this.name = 'IllegalTransitionError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super({
      code: ERROR_CODES.NOT_FOUND,
      message: `${resource} with identifier "${identifier}" not found.`,
      retryable: false,
      details: { resource, identifier },
    });
    this.name = 'NotFoundError';
  }
}

export class InvalidUsernameError extends AppError {
  constructor(username: string) {
    super({
      code: ERROR_CODES.INVALID_USERNAME,
      message: `The username "${username}" is invalid or does not exist on LeetCode.`,
      retryable: false,
      details: { username },
    });
    this.name = 'InvalidUsernameError';
  }
}

export class PrivateOrEmptyProfileError extends AppError {
  constructor(username: string) {
    super({
      code: ERROR_CODES.PRIVATE_OR_EMPTY_PROFILE,
      message: `The profile for "${username}" is private or has no accepted submissions.`,
      retryable: false,
      details: { username },
    });
    this.name = 'PrivateOrEmptyProfileError';
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Rate limit exceeded. Please wait and try again.') {
    super({
      code: ERROR_CODES.RATE_LIMITED,
      message,
      retryable: true,
    });
    this.name = 'RateLimitedError';
  }
}

export class NetworkError extends AppError {
  constructor(message = 'A network error occurred while communicating with the service.', details?: unknown) {
    super({
      code: ERROR_CODES.NETWORK_ERROR,
      message,
      retryable: true,
      details,
    });
    this.name = 'NetworkError';
  }
}

export class UpstreamSchemaChangedError extends AppError {
  constructor(message = 'Upstream response schema has changed or is malformed.', details?: unknown) {
    super({
      code: ERROR_CODES.UPSTREAM_SCHEMA_CHANGED,
      message,
      retryable: false,
      details,
    });
    this.name = 'UpstreamSchemaChangedError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
  }

  if (err instanceof Error) {
    return new AppError({
      code: ERROR_CODES.NETWORK_ERROR,
      message: err.message,
      retryable: false,
      details: { originalName: err.name },
    });
  }

  return new AppError({
    code: ERROR_CODES.NETWORK_ERROR,
    message: String(err),
    retryable: false,
  });
}
