import {
  createTrace,
  type CreateTraceParams,
  type Trace,
} from '../../domain/trace';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';

export type CreateTraceCommand = Omit<CreateTraceParams, never>;

export type CreateTraceResult = Trace;

export class CreateTraceUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: CreateTraceCommand): Promise<CreateTraceResult> {
    const trace = createTrace(command);
    await this.repository.save(trace);
    return trace;
  }
}
