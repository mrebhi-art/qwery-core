import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export type ChatModel = AzureChatOpenAI | ChatOpenAI | ChatAnthropic;

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

export function getChatModel(temperature = 1): ChatModel {
  const azureApiKey =
    readEnv('AZURE_API_KEY') ?? readEnv('AZURE_OPENAI_API_KEY');
  const azureEndpoint =
    readEnv('AZURE_RESOURCE_NAME') ?? readEnv('AZURE_OPENAI_ENDPOINT');
  const azureDeployment = readEnv('AZURE_OPENAI_DEPLOYMENT');
  const azureApiVersion =
    readEnv('AZURE_OPENAI_API_VERSION') ?? '2024-08-01-preview';
  const azureAvailable = !!(azureApiKey && azureEndpoint && azureDeployment);

  // Explicit provider wins; otherwise auto-detect from available credentials
  const provider =
    readEnv('LLM_DEFAULT_PROVIDER') ??
    readEnv('AGENT_PROVIDER') ??
    (azureAvailable ? 'azure' : 'openai');

  if (provider === 'ollama-cloud') {
    const apiKey = readEnv('OLLAMA_API_KEY');
    if (!apiKey) {
      throw new Error(
        "Missing required environment variable 'OLLAMA_API_KEY' for AGENT_PROVIDER=ollama-cloud",
      );
    }

    return new ChatOpenAI({
      apiKey,
      model: readEnv('OLLAMA_MODEL') ?? 'minimax-m2.7',
      temperature,
      configuration: {
        baseURL: readEnv('OLLAMA_BASE_URL') ?? 'https://ollama.com/v1',
      },
    });
  }

  if (provider === 'anthropic') {
    return new ChatAnthropic({
      apiKey: readEnv('ANTHROPIC_API_KEY'),
      model: readEnv('ANTHROPIC_MODEL') ?? 'claude-opus-4-6',
      temperature,
    });
  }

  if (provider === 'azure' && azureAvailable) {
    return new AzureChatOpenAI({
      azureOpenAIApiKey: azureApiKey,
      azureOpenAIApiInstanceName: azureEndpoint,
      azureOpenAIApiDeploymentName: azureDeployment,
      azureOpenAIApiVersion: azureApiVersion,
      temperature,
    });
  }

  return new ChatOpenAI({
    apiKey: readEnv('OPENAI_API_KEY'),
    model: readEnv('OPENAI_MODEL') ?? 'gpt-4o',
    temperature,
  });
}

export function extractJsonFromText(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error('No JSON found in LLM response');
}
