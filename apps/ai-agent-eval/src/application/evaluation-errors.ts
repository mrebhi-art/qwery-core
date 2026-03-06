import type { DatasetId } from '../domain/evaluation';
import type { EvaluationRunId } from '../domain/evaluation';

export class DatasetNotFoundError extends Error {
  constructor(id: DatasetId) {
    super(`Dataset not found: ${id}`);
    this.name = 'DatasetNotFoundError';
  }
}

export class EvaluationRunNotFoundError extends Error {
  constructor(id: EvaluationRunId) {
    super(`Evaluation run not found: ${id}`);
    this.name = 'EvaluationRunNotFoundError';
  }
}
