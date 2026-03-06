import type { TraceId } from '../domain/trace';

export class TraceNotFoundError extends Error {
  constructor(id: TraceId) {
    super(`Trace not found: ${id}`);
    this.name = 'TraceNotFoundError';
  }
}

export class TraceAccessDeniedError extends Error {
  constructor(id: TraceId) {
    super(`Access denied to trace: ${id}`);
    this.name = 'TraceAccessDeniedError';
  }
}
