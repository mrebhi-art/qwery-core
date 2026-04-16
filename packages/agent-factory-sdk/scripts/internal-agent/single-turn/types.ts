export type EnvConfig = {
  question: string;
  model: string;
  agentId: string;
  flowMode: 'compact' | 'full';
  datasourceId: string;
  datasourceName: string;
  datasourceProvider: string;
  datasourceDriver: string;
  datasourceKind: 'embedded' | 'remote';
  datasourceConfig: Record<string, unknown>;
  timeoutMs: number;
};

export type FlowEvent = {
  index: number;
  payload: unknown;
};
