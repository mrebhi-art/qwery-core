import {
  failTrace,
  type FailTraceParams,
  type Trace,
  type TraceId,
} from '../../domain/trace';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import { TraceNotFoundError, TraceAccessDeniedError } from '../errors';

export type FailTraceCommand = {
  traceId: TraceId;
  apiKey: string;
} & FailTraceParams;

export type FailTraceResult = Trace;

export class FailTraceUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: FailTraceCommand): Promise<FailTraceResult> {
    const { traceId, apiKey, ...params } = command;

    const trace = await this.repository.findById(traceId, apiKey);
    if (!trace) throw new TraceNotFoundError(traceId);
    if (trace.apiKey !== apiKey) throw new TraceAccessDeniedError(traceId);

    const failed = failTrace(trace, params);
    await this.repository.save(failed);
    return failed;
  }
}
