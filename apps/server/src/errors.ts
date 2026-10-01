/**
 * Edge mapping from the transport-neutral `DomainError` model to RFC-7807-style
 * HTTP problem details. This is the server's only job here: core services throw
 * domain codes, the transport decides status + `type` strings.
 */

import { DomainError, type DomainErrorCode } from '@al-yo-bo/core';

/** `DomainErrorCode` → HTTP status. */
const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  scrape_unavailable: 503,
  classify_unavailable: 503,
  chat_unavailable: 503,
  upstream_failed: 502,
  scrape_failed: 502,
  classify_failed: 502,
};

/** `DomainErrorCode` → the `type` slug used in `/problems/<slug>` (stable API surface). */
const TYPE_BY_CODE: Record<DomainErrorCode, string> = {
  validation: 'validation',
  not_found: 'not-found',
  conflict: 'conflict',
  unavailable: 'unavailable',
  scrape_unavailable: 'scrape-unavailable',
  classify_unavailable: 'classify-unavailable',
  chat_unavailable: 'chat-unavailable',
  upstream_failed: 'upstream-failed',
  scrape_failed: 'scrape-failed',
  classify_failed: 'classify-failed',
};

export interface ProblemDetails {
  status: number;
  type: string;
  title: string;
}

/**
 * Maps any thrown value to problem details. Unknown errors collapse to a generic
 * 500 so internal messages never leak.
 */
export function toProblemDetails(error: unknown): ProblemDetails {
  if (error instanceof DomainError) {
    return {
      status: STATUS_BY_CODE[error.code],
      type: TYPE_BY_CODE[error.code],
      title: error.message,
    };
  }
  return { status: 500, type: 'internal', title: 'Internal error' };
}
