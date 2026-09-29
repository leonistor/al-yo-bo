/** Lightweight domain errors mapped to RFC-7807-style JSON at the API edge. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'validation');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'not-found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'conflict');
  }
}
