// src/lib/errors.ts
// 통일된 에러 클래스 및 에러 응답 헬퍼

import { NextResponse } from 'next/server';
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', context?: Record<string, unknown>) {
    super('UNAUTHORIZED', message, 401, context);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', context?: Record<string, unknown>) {
    super('FORBIDDEN', message, 403, context);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', context?: Record<string, unknown>) {
    super('NOT_FOUND', message, 404, context);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, context);
    this.name = 'ValidationError';
  }
}

/** catch 블록에서 에러 메시지를 안전하게 추출 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

/** 에러 로깅 */
function captureError(error: unknown) {
  console.error('[Error]', error);
}

/** API route catch 블록용 — AppError이면 그대로, 아니면 500 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const clientMessage = error.statusCode >= 500 ? 'Internal server error' : error.message;
    // Capture 5xx errors in Sentry
    if (error.statusCode >= 500) {
      console.error('[AppError 5xx]', error.code, error.message, error.context);
      captureError(error);
    }
    return NextResponse.json(
      { error: clientMessage, code: error.code },
      { status: error.statusCode },
    );
  }

  // Capture all unhandled errors
  captureError(error);

  console.error('[UNHANDLED]', {
    message: getErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
}
