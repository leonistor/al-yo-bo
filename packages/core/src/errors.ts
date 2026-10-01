/**
 * Transport-neutral domain error model. Handlers at the app edge map a
 * `DomainErrorCode` to an HTTP status/RFC-7807 body; core itself never knows
 * about status codes or response shapes. The base `DomainError` constructor
 * doubles as the way to throw a specific, situational code (e.g.
 * `new DomainError('...', 'scrape_unavailable')`), and the terse subclasses
 * cover the common cases.
 */

export type DomainErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'upstream_failed'
  | 'scrape_failed'
  | 'scrape_unavailable'
  | 'classify_failed'
  | 'classify_unavailable'
  | 'chat_unavailable';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'validation');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super(message, 'not_found');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'conflict');
  }
}

export class UnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 'unavailable');
  }
}

export class UpstreamError extends DomainError {
  constructor(message: string) {
    super(message, 'upstream_failed');
  }
}

/** The manual scrape endpoint is called without a configured scraper. */
export class ScrapeUnavailableError extends DomainError {
  constructor(message = 'Scraping is not available') {
    super(message, 'scrape_unavailable');
  }
}

export class ScrapeFailedError extends DomainError {
  constructor(message: string) {
    super(message, 'scrape_failed');
  }
}

/** The classification endpoint is called without a classifier client. */
export class ClassifyUnavailableError extends DomainError {
  constructor(message = 'Classification is not available') {
    super(message, 'classify_unavailable');
  }
}

export class ClassifyFailedError extends DomainError {
  constructor(message: string) {
    super(message, 'classify_failed');
  }
}

export class ChatUnavailableError extends DomainError {
  constructor(message = 'Chat is not available') {
    super(message, 'chat_unavailable');
  }
}
