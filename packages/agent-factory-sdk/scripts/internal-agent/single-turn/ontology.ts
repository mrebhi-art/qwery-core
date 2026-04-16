import { registerExtensionsFromFolders } from '@qwery/extensions-loader';
import { discoveryService } from '@qwery/semantic-layer/discovery';
import { ontologyService } from '@qwery/semantic-layer/ontology';
import { semanticModelService } from '@qwery/semantic-layer/semantic-model';
import {
  saveDiscoveryRecord,
  saveSemanticModelStatusRecord,
  updateDiscoveryStatus,
} from '@qwery/semantic-layer/store';

export type EnsureOntologyInput = {
  datasourceId: string;
  datasourceName: string;
  datasourceProvider: string;
  datasourceDriver: string;
  datasourceConfig: Record<string, unknown>;
  forceRebuild?: boolean;
};

function applySemanticProviderEnvFromModel(): void {
  const configuredModel =
    process.env['BIRD_MODEL'] ??
    process.env['EVAL_MODEL'] ??
    process.env['MODEL'] ??
    'ollama-cloud/minimax-m2.5';

  const slashIndex = configuredModel.indexOf('/');
  if (slashIndex <= 0) {
    return;
  }

  const provider = configuredModel.slice(0, slashIndex);
  const modelName = configuredModel.slice(slashIndex + 1);

  if (!process.env['AGENT_PROVIDER']) {
    process.env['AGENT_PROVIDER'] = provider;
  }
  if (!process.env['LLM_DEFAULT_PROVIDER']) {
    process.env['LLM_DEFAULT_PROVIDER'] = provider;
  }

  if (provider === 'ollama-cloud') {
    if (!process.env['OLLAMA_MODEL']) {
      process.env['OLLAMA_MODEL'] = modelName;
    }

    if (!process.env['OLLAMA_API_KEY']) {
      throw new Error(
        '[ontology] Missing OLLAMA_API_KEY for ollama-cloud semantic model generation',
      );
    }
  }
}

function resolveDiscoveryDriverId(
  datasourceProvider: string,
  datasourceDriver: string,
): string {
  if (datasourceDriver && datasourceDriver.includes('.')) {
    return datasourceDriver;
  }

  if (!datasourceDriver || datasourceDriver === 'node') {
    if (datasourceProvider === 'duckdb') return 'duckdb.default';
    if (datasourceProvider === 'mysql') return 'mysql.default';
    if (datasourceProvider === 'postgresql') return 'postgresql.default';
    return `${datasourceProvider}.default`;
  }

  return datasourceDriver;
}

export async function ensureDatasourceOntology(
  input: EnsureOntologyInput,
): Promise<{ reused: boolean; datasourceId: string; datasetCount: number }> {
  registerExtensionsFromFolders();
  applySemanticProviderEnvFromModel();

  const current = await ontologyService.getOntologyStatus(input.datasourceId);
  if (
    !input.forceRebuild &&
    current?.status === 'ready' &&
    current.datasetCount > 0
  ) {
    return {
      reused: true,
      datasourceId: input.datasourceId,
      datasetCount: current.datasetCount,
    };
  }

  const driverId = resolveDiscoveryDriverId(
    input.datasourceProvider,
    input.datasourceDriver,
  );

  await updateDiscoveryStatus(input.datasourceId, 'running');

  const schema = await discoveryService.discoverSchema(
    input.datasourceId,
    input.datasourceProvider,
    driverId,
    input.datasourceConfig,
  );

  await saveDiscoveryRecord({
    datasourceId: input.datasourceId,
    status: 'ready',
    updatedAt: new Date().toISOString(),
    error: null,
    schema,
  });

  await saveSemanticModelStatusRecord({
    datasourceId: input.datasourceId,
    status: 'pending',
    updatedAt: new Date().toISOString(),
    generatedAt: null,
    error: null,
  });

  await semanticModelService.generateModel(
    input.datasourceId,
    input.datasourceName,
    driverId,
    input.datasourceConfig,
  );

  const ontology = await ontologyService.buildOntology(input.datasourceId);
  if (ontology.status !== 'ready' || ontology.datasetCount <= 0) {
    throw new Error(
      `[ontology] Ontology build completed without indexed datasets for ${input.datasourceId}`,
    );
  }

  return {
    reused: false,
    datasourceId: input.datasourceId,
    datasetCount: ontology.datasetCount,
  };
}
