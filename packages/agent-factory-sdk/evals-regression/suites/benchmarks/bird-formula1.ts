import { ensureBirdOntologyForDataset } from '../_shared/ensure-bird-ontology';

const configuredModel =
  process.env.EVAL_MODEL ??
  process.env.DEFAULT_MODEL ??
  process.env.MODEL ??
  'ollama-cloud/minimax-m2.5';

if (!configuredModel.startsWith('ollama-cloud/')) {
  throw new Error(
    `[bird-benchmark] Only ollama-cloud models are allowed. Received model="${configuredModel}"`,
  );
}

// Keep the same slice as the former BirdBenchmark-based runner.
process.env['BIRD_DB_IDS'] = '';
process.env['BIRD_DB_ID'] = 'formula_1';
process.env['BIRD_DIFFICULTY'] = 'simple,moderate';
process.env['BIRD_LIMIT'] = process.env['BIRD_LIMIT'] ?? '10';
process.env['BIRD_SPLIT'] = process.env['BIRD_SPLIT'] ?? 'mini_dev_sqlite';

process.env['EVAL_MINIMAL_CASE_OUTPUT'] =
  process.env['EVAL_MINIMAL_CASE_OUTPUT'] ?? '0';

process.env['EVAL_INCREMENTAL_RESULTS'] =
  process.env['EVAL_INCREMENTAL_RESULTS'] ?? '1';

if (process.env['BIRD_BUILD_ONTOLOGY'] !== '0') {
  const ontologyDbId = process.env['BIRD_DB_ID'] ?? 'formula_1';
  console.log(`  Building ontology for ${ontologyDbId} datasource…`);
  await ensureBirdOntologyForDataset(ontologyDbId, configuredModel);

  // Avoid repeated per-case ontology builds inside child processes.
  process.env['BIRD_BUILD_ONTOLOGY'] = '0';
}

await import('./bird-local-loop');
