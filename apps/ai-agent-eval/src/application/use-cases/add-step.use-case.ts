import {
  addStepToTrace,
  type AddStepParams,
  type Trace,
  type TraceId,
} from '../../domain/trace';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import { TraceNotFoundError, TraceAccessDeniedError } from '../errors';

export type AddStepCommand = {
  traceId: TraceId;
  apiKey: string;
} & AddStepParams;

export type AddStepResult = Trace;

export class AddStepUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: AddStepCommand): Promise<AddStepResult> {
    const { traceId, apiKey, ...stepParams } = command;

    const trace = await this.repository.findById(traceId, apiKey);
    if (!trace) throw new TraceNotFoundError(traceId);
    if (trace.apiKey !== apiKey) throw new TraceAccessDeniedError(traceId);

    const updated = addStepToTrace(trace, stepParams);
    await this.repository.save(updated);
    return updated;
  }
}
