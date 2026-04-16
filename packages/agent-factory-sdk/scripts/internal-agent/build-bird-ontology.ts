import { ensureDatasourceOntology } from './single-turn/ontology';
import { prepareBirdDatasource } from './single-turn/bird-datasource';

const DEFAULT_DATASET = 'bird';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token.startsWith('--') && token.includes('=')) {
      const [k, v] = token.split('=', 2);
      parsed[k.slice(2)] = v ?? '';
      continue;
    }

    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i += 1;
      } else {
        parsed[key] = true;
      }
    }
  }

  return parsed;
}

function normalizeDatasetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function resolveDbIds(datasetKey: string): string[] {
  switch (normalizeDatasetKey(datasetKey)) {
    case 'bird':
    case 'all':
    case 'bird_all':
      return ['california_schools', 'formula_1'];
    case 'bird_formula1':
    case 'formula1':
    case 'formula_1':
      return ['formula_1'];
    case 'bird_schools':
    case 'schools':
    case 'california_schools':
      return ['california_schools'];
    default:
      throw new Error(
        `Unsupported dataset "${datasetKey}". Use one of: bird, formula_1, california_schools.`,
      );
  }
}

function parseDbIds(args: Record<string, string | boolean>): string[] {
  const argDbIds =
    (typeof args['dbIds'] === 'string' ? args['dbIds'] : undefined) ??
    (typeof args['dbId'] === 'string' ? args['dbId'] : undefined);

  const envDbIds = process.env['BIRD_DB_IDS'] ?? process.env['BIRD_DB_ID'];
  const raw = argDbIds ?? envDbIds;

  if (!raw) return [];

  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const forceRebuild =
    args['force'] === true ||
    process.env['BIRD_FORCE_REBUILD'] === '1' ||
    process.env['BIRD_REBUILD_ONTOLOGY'] === '1';

  const explicitDbIds = parseDbIds(args);
  const dataset =
    (typeof args['dataset'] === 'string' ? args['dataset'] : undefined) ??
    process.env['BIRD_DATASET'] ??
    DEFAULT_DATASET;

  const dbIds = explicitDbIds.length > 0 ? explicitDbIds : resolveDbIds(dataset);

  console.log('[build-bird-ontology] dataset:', dataset);
  console.log('[build-bird-ontology] dbIds:', dbIds.join(', '));
  console.log('[build-bird-ontology] forceRebuild:', forceRebuild ? 'yes' : 'no');

  for (const dbId of dbIds) {
    console.log(`\n[build-bird-ontology] preparing datasource for ${dbId}...`);
    const datasource = await prepareBirdDatasource(dbId);

    console.log('[build-bird-ontology] sqlitePath:', datasource.sqlitePath);
    console.log('[build-bird-ontology] duckdbPath:', datasource.duckdbPath);
    console.log('[build-bird-ontology] datasourceId:', datasource.datasourceId);

    const result = await ensureDatasourceOntology({
      datasourceId: datasource.datasourceId,
      datasourceName: datasource.datasourceName,
      datasourceProvider: datasource.datasourceProvider,
      datasourceDriver: datasource.datasourceDriver,
      datasourceConfig: datasource.datasourceConfig,
      forceRebuild,
    });

    console.log(
      `[build-bird-ontology] ${result.reused ? 'reused' : 'built'} ontology for ${result.datasourceId} (datasets=${result.datasetCount})`,
    );
  }

  console.log('\n[build-bird-ontology] done');
}

main().catch((error) => {
  console.error(
    '[build-bird-ontology] failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
