#!/usr/bin/env node
/**
 * regression-check.mjs
 *
 * Automates before/after version comparison using git worktrees.
 * Creates a temporary worktree at --base, runs the eval suite there,
 * removes the worktree, runs the same suite from HEAD, then prints
 * the comparison URL.
 *
 * Usage:
 *   node scripts/regression-check.mjs --base <ref> --suite <name> [--open]
 *
 * Options:
 *   --base <ref>    git ref for baseline (commit, branch, tag). E.g. HEAD^, main, abc1234
 *   --suite <name>  Eval suite:
 *                   sql | chart | tools | safety | intents | ask | latency | mustache-token
 *                   | multi-turn | context-retention | conv-correction
 *                   | bird | bird-schools | bird-formula1 | all
 *   --open          Open the comparison URL in the browser after running
 *   --model <id>    Model to use for both runs (default: env EVAL_MODEL)
 *   --overlay-src   Overlay HEAD src/tracing-sdk into baseline (off by default)
 *   --strict        Exit non-zero when any suite process fails
 *   --report <path> Write JSON report (auto-written on failures)
 *
 * Examples:
 *   node scripts/regression-check.mjs --base main --suite chart --open
 *   node scripts/regression-check.mjs --base HEAD^ --suite all
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const WORKTREE_PATH = resolve(REPO_ROOT, '..', 'qwery-core-regression-baseline');
const BASELINE_PKG = join(WORKTREE_PATH, 'packages', 'agent-factory-sdk');
const UI_BASE_URL = process.env.EVAL_UI_BASE_URL ?? 'http://localhost:5090';
const SHELL = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
/** @param {string} name */
function arg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}
/** @param {string} name */
function flag(name) {
  return args.includes(name);
}

const baseRef = arg('--base');
const suite = arg('--suite') ?? 'chart';
const openBrowser = flag('--open');
const model = arg('--model') ?? process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';
const strictMode = flag('--strict');
const overlaySrc = flag('--overlay-src');
const reportPathArg = arg('--report');

if (!baseRef) {
  console.error('❌  --base <ref> is required');
  console.error('   Example: node scripts/regression-check.mjs --base main --suite chart');
  process.exit(1);
}

// ─── Resolve base ref to short SHA ───────────────────────────────────────────

let baseSha;
try {
  baseSha = exec(`git rev-parse --short "${baseRef}"`, REPO_ROOT).trim();
} catch {
  console.error(`❌  Could not resolve git ref: ${baseRef}`);
  process.exit(1);
}
const fullSha = exec(`git rev-parse "${baseRef}"`, REPO_ROOT).trim();
const headSha = exec('git rev-parse --short HEAD', REPO_ROOT).trim();

const versionBefore = `${baseSha}-before`;
const versionAfter = `${baseSha}-after`;

/** @type {Record<string, { script: string; dataset: string }>} */
const SUITES = {
  sql: { script: 'evals-regression/suites/single-turn/sql-quality-eval-suite.ts', dataset: 'sql-quality-evals' },
  chart: { script: 'evals-regression/suites/single-turn/chart-generation-eval-suite.ts', dataset: 'chart-generation-evals' },
  tools: { script: 'evals-regression/suites/single-turn/tool-sequence-eval-suite.ts', dataset: 'tool-sequence-evals' },
  safety: { script: 'evals-regression/suites/single-turn/destructive-safety-eval-suite.ts', dataset: 'destructive-safety-evals' },
  intents: { script: 'evals-regression/suites/single-turn/expanded-intent-eval-suite.ts', dataset: 'expanded-intent-evals' },
  ask: { script: 'evals-regression/suites/single-turn/ask-eval-suite.ts', dataset: 'ask-agent-core-evals' },
  latency: { script: 'evals-regression/suites/single-turn/latency-token-eval-suite.ts', dataset: 'latency-token-metrics' },
  'mustache-token': { script: 'evals-regression/suites/single-turn/mustache-token-optimization-eval-suite.ts', dataset: 'mustache-token-optimization' },
  'multi-turn': { script: 'evals-regression/suites/multi-turn/multi-turn-ask-eval-suite.ts', dataset: 'multi-turn-ask-evals' },
  'context-retention': { script: 'evals-regression/suites/multi-turn/context-retention-eval-suite.ts', dataset: 'context-retention-evals' },
  'conv-correction': { script: 'evals-regression/suites/multi-turn/conversation-correction-eval-suite.ts', dataset: 'conversation-correction-evals' },
  bird: { script: 'evals-regression/suites/benchmarks/bird-eval-suite.ts', dataset: 'bird-mini_dev_sqlite' },
  'bird-schools': { script: 'evals-regression/suites/benchmarks/bird-california-schools.ts', dataset: 'bird-mini_dev_sqlite' },
  'bird-formula1': { script: 'evals-regression/suites/benchmarks/bird-formula1.ts', dataset: 'bird-mini_dev_sqlite' },
};

const failures = [];

const suitesToRun = suite === 'all' ? Object.keys(SUITES) : [suite];
const unknownSuites = suitesToRun.filter((s) => !SUITES[s]);
if (unknownSuites.length > 0) {
  console.error(`❌  Unknown suite(s): ${unknownSuites.join(', ')}`);
  console.error(`   Valid: ${Object.keys(SUITES).join(', ')}, all`);
  process.exit(1);
}

console.log('');
console.log(`🔀  Qwery Regression Check`);
console.log(`    Base ref:  ${baseRef} (${baseSha})`);
console.log(`    Head:      ${headSha}`);
console.log(`    Suite(s):  ${suitesToRun.join(', ')}`);
console.log(`    Model:     ${model}`);
console.log(`    Strict:    ${strictMode ? 'on' : 'off'}`);
console.log(`    Overlay:   ${overlaySrc ? 'on (compare prompts/tools only)' : 'off (true before/after code diff)'}`);
console.log('');

// ─── Step 1: Scaffold baseline worktree (src only — no install needed) ────────

// Always prune stale worktree registrations first (handles cases where the
// directory was deleted externally but git still holds a ref to it).
try { exec('git worktree prune', REPO_ROOT); } catch { /* non-fatal */ }

if (existsSync(WORKTREE_PATH)) {
  console.log(`🧹  Removing stale worktree at ${WORKTREE_PATH}…`);
  removeWorktree();
}

console.log(`📦  Creating worktree at ${WORKTREE_PATH} (${baseSha})…`);
exec(`git worktree add -f "${WORKTREE_PATH}" ${fullSha}`, REPO_ROOT);
patchBaselinePackageJson(BASELINE_PKG);

console.log(`🔗  Copying evals-regression into baseline worktree…`);
cpSync(join(PKG_ROOT, 'evals-regression'), join(BASELINE_PKG, 'evals-regression'), {
  recursive: true,
  // Allow the @qwery/shared shim (evals-regression/node_modules/@qwery/shared) — block everything else under node_modules
  filter: (src) => !src.includes('node_modules') || src.includes(join('node_modules', '@qwery', 'shared')),
});
if (overlaySrc) {
  // Optional mode: compare prompt/tool behavior while pinning SDK + tracing code to HEAD.
  console.log(`🔗  Copying src/ into baseline worktree (overlay mode)…`);
  cpSync(join(PKG_ROOT, 'src'), join(BASELINE_PKG, 'src'), { recursive: true, filter: (src) => !src.includes('node_modules') });
  console.log(`🔗  Copying packages/tracing-sdk into baseline worktree (overlay mode)…`);
  cpSync(join(REPO_ROOT, 'packages', 'tracing-sdk'), join(WORKTREE_PATH, 'packages', 'tracing-sdk'), { recursive: true, filter: (src) => !src.includes('node_modules') });
}

// ─── Link node_modules so tsx can resolve workspace packages without a full install ───
// We need two junctions:
//   1. Repo-root node_modules  → for shared tooling (tsx itself, etc.)
//   2. Package-level node_modules → for 'ai', '@qwery/shared', etc.
const baselineRootNm = join(WORKTREE_PATH, 'node_modules');
const baselinePkgNm = join(BASELINE_PKG, 'node_modules');
const headRootNm = join(REPO_ROOT, 'node_modules');
const headPkgNm = join(PKG_ROOT, 'node_modules');
if (!existsSync(baselineRootNm)) {
  console.log(`🔗  Linking root node_modules into baseline worktree…`);
  execSync(`mklink /J "${baselineRootNm}" "${headRootNm}"`, { shell: SHELL, stdio: 'inherit' });
} else {
  console.log(`ℹ️   Root node_modules junction already exists`);
}
if (!existsSync(baselinePkgNm)) {
  console.log(`🔗  Linking packages/agent-factory-sdk/node_modules into baseline worktree…`);
  execSync(`mklink /J "${baselinePkgNm}" "${headPkgNm}"`, { shell: SHELL, stdio: 'inherit' });
} else {
  console.log(`ℹ️   Package node_modules junction already exists`);
}

// Bun auto-loads .env files from the package root — copy them so OLLAMA_API_KEY etc. are available.
for (const envFile of ['.env', '.env.local', '.env.development', '.env.production']) {
  const src = join(PKG_ROOT, envFile);
  if (existsSync(src)) {
    cpSync(src, join(BASELINE_PKG, envFile));
  }
}
console.log('');

// ─── Step 2: Run evals from baseline ──────────────────────────────────────────

console.log(`⏮  Running BEFORE evals (${versionBefore})…`);
for (const s of suitesToRun) {
  const suiteDef = SUITES[s];
  if (!suiteDef) continue;
  const { script } = suiteDef;
  console.log(`   › ${script}`);
  const suiteEnv = buildSuiteEnv(model, versionBefore);
  const result = spawnSync(
    'bun',
    [join(BASELINE_PKG, script)],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: suiteEnv,
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.warn(`   ⚠  ${script} exited with code ${result.status} (continuing)`);
    failures.push({ phase: 'before', suite: s, script, exitCode: result.status });
  }
}

// ─── Step 3: Remove worktree ──────────────────────────────────────────────────

console.log('');
console.log(`🧹  Removing worktree…`);
removeWorktree();

// ─── Step 4: Run evals from current HEAD ──────────────────────────────────────

console.log('');
console.log(`⏭  Running AFTER evals (${versionAfter})…`);
for (const s of suitesToRun) {
  const suiteDef = SUITES[s];
  if (!suiteDef) continue;
  const { script } = suiteDef;
  console.log(`   › ${script}`);
  const suiteEnv = buildSuiteEnv(model, versionAfter);
  const result = spawnSync(
    'bun',
    [script],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: suiteEnv,
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.warn(`   ⚠  ${script} exited with code ${result.status} (continuing)`);
    failures.push({ phase: 'after', suite: s, script, exitCode: result.status });
  }
}

// ─── Step 5: Print comparison URLs ───────────────────────────────────────────

console.log('');
console.log('✅  Done! View comparisons in the UI:');
const comparisonUrls = [];
for (const s of suitesToRun) {
  const suiteDef = SUITES[s];
  if (!suiteDef) continue;
  const { dataset } = suiteDef;
  const url = `${UI_BASE_URL}/compare?dataset=${encodeURIComponent(dataset)}&vA=${encodeURIComponent(versionBefore)}&vB=${encodeURIComponent(versionAfter)}`;
  comparisonUrls.push({ suite: s, dataset, url });
  console.log(`   ${s.padEnd(10)} → ${url}`);

  if (openBrowser) {
    const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(`${opener} "${url}"`, { cwd: PKG_ROOT, shell: SHELL, stdio: 'ignore' }); } catch { /* non-fatal */ }
  }
}
console.log('');

const report = {
  createdAt: new Date().toISOString(),
  baseRef,
  baseSha,
  fullSha,
  headSha,
  model,
  versionBefore,
  versionAfter,
  suites: suitesToRun,
  overlaySrc,
  strictMode,
  failures,
  comparisonUrls,
};

if (reportPathArg || failures.length > 0) {
  const reportPath = reportPathArg
    ? resolve(PKG_ROOT, reportPathArg)
    : join(PKG_ROOT, 'evals-regression', 'reports', `regression-${Date.now()}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`🧾  Regression report saved: ${reportPath}`);
}

if (failures.length > 0) {
  console.log('');
  console.log(`❌  ${failures.length} suite run(s) failed:`);
  for (const item of failures) {
    console.log(`   - [${item.phase}] ${item.suite} (${item.script}) exit=${item.exitCode}`);
  }
  if (strictMode) {
    process.exit(2);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string} cmd @param {string} cwd */
function exec(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
}

/**
 * Some internal chart helpers resolve model via AGENT_PROVIDER/default provider,
 * not EVAL_MODEL directly. Mirror provider vars from the selected model so evals
 * stay on the intended provider in both before/after runs.
 * @param {string} modelString
 * @param {string} agentVersion
 */
function buildSuiteEnv(modelString, agentVersion) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, AGENT_VERSION: agentVersion, EVAL_MODEL: modelString };
  const [provider, ...rest] = modelString.split('/');
  const modelName = rest.join('/');

  if (!provider || !modelName) {
    return env;
  }

  env.AGENT_PROVIDER = provider;

  if (provider === 'ollama' || provider === 'ollama-cloud') {
    env.OLLAMA_MODEL = env.OLLAMA_MODEL ?? modelName;
  }

  if (provider === 'azure') {
    env.AZURE_OPENAI_DEPLOYMENT = env.AZURE_OPENAI_DEPLOYMENT ?? modelName;
  }

  if (provider === 'anthropic') {
    env.ANTHROPIC_MODEL = env.ANTHROPIC_MODEL ?? modelName;
  }

  if (provider === 'transformer' || provider === 'transformer-browser') {
    env.TRANSFORMER_MODEL = env.TRANSFORMER_MODEL ?? modelName;
  }

  if (provider === 'webllm') {
    env.WEBLLM_MODEL = env.WEBLLM_MODEL ?? modelName;
  }

  return env;
}

/**
 * git worktree remove --force cannot delete directories that contain
 * untracked files (e.g. node_modules). We remove the directory manually
 * first, then prune the stale worktree reference.
 */
function removeWorktree() {
  const rmCmd = process.platform === 'win32'
    ? `rmdir /s /q "${WORKTREE_PATH}"`
    : `rm -rf "${WORKTREE_PATH}"`;
  try { execSync(rmCmd, { cwd: REPO_ROOT, shell: SHELL, stdio: 'inherit' }); } catch { /* ignore */ }
  try { exec('git worktree prune', REPO_ROOT); } catch { /* ignore */ }
}

/**
 * Merges the eval:suite:* scripts from HEAD's package.json into the
 * baseline worktree's package.json, in case the baseline predates them.
 */
/** @param {string} baselinePkgDir */
function patchBaselinePackageJson(baselinePkgDir) {
  const headPkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  const baselinePkg = JSON.parse(readFileSync(join(baselinePkgDir, 'package.json'), 'utf8'));
  const evalScripts = Object.fromEntries(
    Object.entries(headPkg.scripts ?? {}).filter(([k]) => k.startsWith('eval:suite')),
  );
  baselinePkg.scripts = { ...(baselinePkg.scripts ?? {}), ...evalScripts };
  writeFileSync(join(baselinePkgDir, 'package.json'), JSON.stringify(baselinePkg, null, 2), 'utf8');
}
