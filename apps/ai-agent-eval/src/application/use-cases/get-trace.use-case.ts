import type { Trace, TraceId } from '../../domain/trace';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import { TraceNotFoundError, TraceAccessDeniedError } from '../errors';

export type GetTraceCommand = {
  traceId: TraceId;
  apiKey: string;
};

export type GetTraceResult = Trace;

export class GetTraceUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: GetTraceCommand): Promise<GetTraceResult> {
    const trace = await this.repository.findById(command.traceId, command.apiKey);
    if (!trace) throw new TraceNotFoundError(command.traceId);
    if (trace.apiKey !== command.apiKey)
      throw new TraceAccessDeniedError(command.traceId);
    return trace;
  }
}
