import type { AgentExecutorPort, AgentResponse } from '../../domain/ports/agent-executor.port';

// ─── HTTP Adapter ─────────────────────────────────────────────────────────────
// Calls an external agent chat endpoint.
// Expected request: POST <agentUrl>  { message: string, context?: string }
// Expected response: { output: string }

export class HttpAgentExecutorAdapter implements AgentExecutorPort {
  constructor(private readonly agentUrl: string) {}

  async executeAgent(input: string, context: string | null): Promise<AgentResponse> {
    const res = await fetch(this.agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, context: context ?? undefined }),
    });

    if (!res.ok) {
      throw new Error(`Agent HTTP error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { output?: string; message?: string; content?: string };
    const output = json.output ?? json.message ?? json.content ?? '';
    return { output: String(output) };
  }
}
