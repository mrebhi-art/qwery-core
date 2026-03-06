import type { Trace } from '../../domain/trace';
import type {
  TraceRepository,
  ListTracesFilter,
} from '../../domain/ports/trace-repository.port';

export type ListTracesCommand = {
  apiKey: string;
  filter?: ListTracesFilter;
};

export type ListTracesResult = Trace[];

export class ListTracesUseCase {
  constructor(private readonly repository: TraceRepository) {}

  async execute(command: ListTracesCommand): Promise<ListTracesResult> {
    return this.repository.list(command.apiKey, command.filter);
  }
}
