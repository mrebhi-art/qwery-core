import { BirdBenchmark, BirdTask } from '@qwery/tracing-sdk/eval';
import { runBirdSingleTurnScriptHarness } from '../_shared/bird-single-turn-script-harness';
import { ensureBirdOntologyForDataset } from '../_shared/ensure-bird-ontology';
import { EVAL_PROJECT_ID } from '../_shared/eval-project';

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

const MODEL = configuredModel;

const INCLUDE_EVIDENCE = process.env['BIRD_INCLUDE_EVIDENCE'] !== '0';

process.env['EVAL_MINIMAL_CASE_OUTPUT'] =
  process.env['EVAL_MINIMAL_CASE_OUTPUT'] ?? '0';

process.env['EVAL_INCREMENTAL_RESULTS'] =
  process.env['EVAL_INCREMENTAL_RESULTS'] ?? '1';

const benchmark = new BirdBenchmark({
  tasks: [BirdTask.CALIFORNIA_SCHOOLS, BirdTask.FORMULA_1],
  difficulty: ['simple', 'moderate','challenging'],
  limit: 6,
  split: 'mini_dev_sqlite',
  includeEvidence: INCLUDE_EVIDENCE,
  execution: {
    dbRoot: process.env.BIRD_SQLITE_ROOT ?? process.env.BIRD_DB_ROOT,
    requireDbRoot: true,
  },
});

if (process.env['BIRD_BUILD_ONTOLOGY'] !== '0') {
  console.log('  Building ontology for BIRD benchmark datasources…');
  await ensureBirdOntologyForDataset('bird', MODEL);
}

// Pass a factory (dbId) => agentFn so the benchmark injects the right schema per case
await benchmark.evaluate(
  (dbId: string) => (input: string) =>
    runBirdSingleTurnScriptHarness({
      dbId,
      question: input,
      model: MODEL,
    }),
  {
    agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
    baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
    projectId: EVAL_PROJECT_ID,
    concurrency: Number(process.env.EVAL_CASE_CONCURRENCY ?? '1'),
  },
);

console.log('\n─── BIRD Benchmark Results ───────────────────────────────────────');
console.log('Overall score:     ', benchmark.overallScore.toFixed(3));
console.log('Task scores:       ', benchmark.taskScores);
console.log('Difficulty:        ', benchmark.difficultyBreakdown);
console.log('──────────────────────────────────────────────────────────────────\n');
