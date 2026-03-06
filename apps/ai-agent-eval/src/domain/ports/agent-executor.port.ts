// ─── Agent Executor Port (driving side) ──────────────────────────────────────
// The evaluation service never imports agent code directly.
// It calls agents through this port, which is implemented by an HTTP adapter.

export type AgentResponse = {
  output: string;
};

export interface AgentExecutorPort {
  executeAgent(input: string, context: string | null): Promise<AgentResponse>;
}
