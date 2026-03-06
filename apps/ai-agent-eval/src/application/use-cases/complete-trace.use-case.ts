import {
  completeTrace,
  type CompleteTraceParams,
  type Trace,
  type TraceId,
} from '../../domain/trace';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import { TraceNotFoundError, TraceAccessDeniedError } from '../errors';

export type CompleteTraceCommand = {
  traceId: TraceId;
  apiKey: string;
} & CompleteTraceParams;

export type CompleteTraceResult = Trace;

export class CompleteTraceUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: CompleteTraceCommand): Promise<CompleteTraceResult> {
    const { traceId, apiKey, ...params } = command;

    const trace = await this.repository.findById(traceId, apiKey);
    if (!trace) throw new TraceNotFoundError(traceId);
    if (trace.apiKey !== apiKey) throw new TraceAccessDeniedError(traceId);

    const completed = completeTrace(trace, params);
    await this.repository.save(completed);
    return completed;
  }
}
