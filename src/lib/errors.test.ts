// Unit tests for errors
import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  getErrorMessage,
  toErrorResponse,
} from './errors';

// ---------------------------------------------------------------------------
// Error class hierarchy
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('stores code, message, and statusCode', () => {
    const err = new AppError('MY_CODE', 'something broke', 422);
    expect(err.code).toBe('MY_CODE');
    expect(err.message).toBe('something broke');
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults statusCode to 500', () => {
    const err = new AppError('ERR', 'oops');
    expect(err.statusCode).toBe(500);
  });

  it('stores optional context', () => {
    const ctx = { detail: 'extra info' };
    const err = new AppError('ERR', 'msg', 400, ctx);
    expect(err.context).toEqual(ctx);
  });
});

describe('AuthError', () => {
  it('has statusCode 401', () => {
    expect(new AuthError().statusCode).toBe(401);
  });

  it('has default message "Unauthorized"', () => {
    expect(new AuthError().message).toBe('Unauthorized');
  });

  it('accepts a custom message', () => {
    expect(new AuthError('Token expired').message).toBe('Token expired');
  });

  it('name is AuthError', () => {
    expect(new AuthError().name).toBe('AuthError');
  });

  it('is instance of AppError and Error', () => {
    const e = new AuthError();
    expect(e).toBeInstanceOf(AppError);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('ForbiddenError', () => {
  it('has statusCode 403', () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });

  it('has default message "Forbidden"', () => {
    expect(new ForbiddenError().message).toBe('Forbidden');
  });

  it('name is ForbiddenError', () => {
    expect(new ForbiddenError().name).toBe('ForbiddenError');
  });
});

describe('NotFoundError', () => {
  it('has statusCode 404', () => {
    expect(new NotFoundError().statusCode).toBe(404);
  });

  it('has default message "Not found"', () => {
    expect(new NotFoundError().message).toBe('Not found');
  });

  it('name is NotFoundError', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});

describe('ValidationError', () => {
  it('has statusCode 400', () => {
    expect(new ValidationError('bad input').statusCode).toBe(400);
  });

  it('stores the provided message', () => {
    expect(new ValidationError('field required').message).toBe('field required');
  });

  it('name is ValidationError', () => {
    expect(new ValidationError('x').name).toBe('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// toErrorResponse
// ---------------------------------------------------------------------------

describe('toErrorResponse', () => {
  it('returns the correct HTTP status for a 4xx AppError', async () => {
    const err = new ValidationError('Invalid field');
    const res = toErrorResponse(err);
    expect(res.status).toBe(400);
  });

  it('returns the original message for a 4xx AppError', async () => {
    const err = new NotFoundError('Widget not found');
    const res = toErrorResponse(err);
    const body = await res.json();
    expect(body.error).toBe('Widget not found');
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 401 status for AuthError', async () => {
    const res = toErrorResponse(new AuthError());
    expect(res.status).toBe(401);
  });

  it('returns 403 status for ForbiddenError', async () => {
    const res = toErrorResponse(new ForbiddenError());
    expect(res.status).toBe(403);
  });

  it('replaces message with "Internal server error" for 5xx AppError', async () => {
    const err = new AppError('DB_FAIL', 'Connection string leaked', 500);
    const res = toErrorResponse(err);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    // code is still forwarded
    expect(body.code).toBe('DB_FAIL');
  });

  it('returns 500 for non-AppError', async () => {
    const res = toErrorResponse(new Error('raw error'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });

  it('returns 500 for thrown string', async () => {
    const res = toErrorResponse('something went wrong');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns string directly', () => {
    expect(getErrorMessage('raw string error')).toBe('raw string error');
  });

  it('extracts message from plain object with message property', () => {
    expect(getErrorMessage({ message: 'object error' })).toBe('object error');
  });

  it('coerces numeric message to string', () => {
    expect(getErrorMessage({ message: 42 })).toBe('42');
  });

  it('returns "Unknown error" for null', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
  });

  it('returns "Unknown error" for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('returns "Unknown error" for empty object', () => {
    expect(getErrorMessage({})).toBe('Unknown error');
  });
});
