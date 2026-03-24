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
 *   --suite <name>  Eval suite: sql | chart | tools | safety | intents | ask | all
 *   --open          Open the comparison URL in the browser after running
 *   --model <id>    Model to use for both runs (default: env EVAL_MODEL)
 *
 * Examples:
 *   node scripts/regression-check.mjs --base main --suite chart --open
 *   node scripts/regression-check.mjs --base HEAD^ --suite all
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const WORKTREE_PATH = resolve(REPO_ROOT, '..', 'qwery-core-regression-baseline');
const BASELINE_PKG = join(WORKTREE_PATH, 'packages', 'agent-factory-sdk');
const EVAL_BASE_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:4097';
const UI_BASE_URL = process.env.EVAL_UI_BASE_URL ?? 'http://localhost:5090';

// ─── Resolve tsx CLI directly (avoids npm static ESM linker race) ─────────────
// `npx tsx` triggers Node's static ESM export validation before tsx's hook fires,
// causing `@qwery/shared/logger` (.ts exports) to fail. We resolve cli.mjs directly.
function resolveTsxCli(root) {
  // Prefer pnpm store: scan node_modules/.pnpm for tsx@*
  const pnpmDir = join(root, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    const entry = readdirSync(pnpmDir).find((d) => d.startsWith('tsx@'));
    if (entry) {
      const cli = join(pnpmDir, entry, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (existsSync(cli)) return cli;
    }
  }
  // Fallback: regular node_modules (npm/yarn)
  const fallback = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(fallback)) return fallback;
  throw new Error('Could not locate tsx/dist/cli.mjs in ' + root);
}
const TSX_CLI = resolveTsxCli(REPO_ROOT);

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}
function flag(name) {
  return args.includes(name);
}

const baseRef = arg('--base');
const suite = arg('--suite') ?? 'chart';
const openBrowser = flag('--open');
const model = arg('--model') ?? process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

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

const versionBefore = `${baseSha}-before`;
const versionAfter = `${baseSha}-after`;

const SUITES = {
  sql: { script: 'evals-regression/suites/sql-quality-eval-suite.ts', dataset: 'sql-quality-evals' },
  chart: { script: 'evals-regression/suites/chart-generation-eval-suite.ts', dataset: 'chart-generation-evals' },
  tools: { script: 'evals-regression/suites/tool-sequence-eval-suite.ts', dataset: 'tool-sequence-evals' },
  safety: { script: 'evals-regression/suites/destructive-safety-eval-suite.ts', dataset: 'destructive-safety-evals' },
  intents: { script: 'evals-regression/suites/expanded-intent-eval-suite.ts', dataset: 'expanded-intent-evals' },
  ask: { script: 'evals-regression/suites/ask-eval-suite.ts', dataset: 'ask-agent-evals' },
};

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
console.log(`    Suite(s):  ${suitesToRun.join(', ')}`);
console.log(`    Model:     ${model}`);
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
// Also overlay HEAD's src/ so both runs use identical SDK code — isolates regressions to agent
// behaviour only, not to SDK/provider changes between the two commits.
console.log(`🔗  Copying src/ into baseline worktree…`);
cpSync(join(PKG_ROOT, 'src'), join(BASELINE_PKG, 'src'), { recursive: true, filter: (src) => !src.includes('node_modules') });
console.log(`🔗  Copying packages/tracing-sdk into baseline worktree…`);
cpSync(join(REPO_ROOT, 'packages', 'tracing-sdk'), join(WORKTREE_PATH, 'packages', 'tracing-sdk'), { recursive: true, filter: (src) => !src.includes('node_modules') });

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
  execSync(`mklink /J "${baselineRootNm}" "${headRootNm}"`, { shell: true, stdio: 'inherit' });
} else {
  console.log(`ℹ️   Root node_modules junction already exists`);
}
if (!existsSync(baselinePkgNm)) {
  console.log(`🔗  Linking packages/agent-factory-sdk/node_modules into baseline worktree…`);
  execSync(`mklink /J "${baselinePkgNm}" "${headPkgNm}"`, { shell: true, stdio: 'inherit' });
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
  const { script } = SUITES[s];
  console.log(`   › ${script}`);
  const result = spawnSync(
    'bun',
    [join(BASELINE_PKG, script)],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: { ...process.env, AGENT_VERSION: versionBefore, EVAL_MODEL: model },
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.warn(`   ⚠  ${script} exited with code ${result.status} (continuing)`);
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
  const { script } = SUITES[s];
  console.log(`   › ${script}`);
  const result = spawnSync(
    'bun',
    [script],
    {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: { ...process.env, AGENT_VERSION: versionAfter, EVAL_MODEL: model },
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.warn(`   ⚠  ${script} exited with code ${result.status} (continuing)`);
  }
}

// ─── Step 5: Print comparison URLs ───────────────────────────────────────────

console.log('');
console.log('✅  Done! View comparisons in the UI:');
for (const s of suitesToRun) {
  const { dataset } = SUITES[s];
  const url = `${UI_BASE_URL}/compare?dataset=${encodeURIComponent(dataset)}&vA=${encodeURIComponent(versionBefore)}&vB=${encodeURIComponent(versionAfter)}`;
  console.log(`   ${s.padEnd(10)} → ${url}`);

  if (openBrowser) {
    const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(`${opener} "${url}"`, { cwd: PKG_ROOT, shell: true, stdio: 'ignore' }); } catch { /* non-fatal */ }
  }
}
console.log('');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exec(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
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
  try { execSync(rmCmd, { cwd: REPO_ROOT, shell: true, stdio: 'inherit' }); } catch { /* ignore */ }
  try { exec('git worktree prune', REPO_ROOT); } catch { /* ignore */ }
}

/**
 * Merges the eval:suite:* scripts from HEAD's package.json into the
 * baseline worktree's package.json, in case the baseline predates them.
 */
function patchBaselinePackageJson(baselinePkgDir) {
  const headPkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  const baselinePkg = JSON.parse(readFileSync(join(baselinePkgDir, 'package.json'), 'utf8'));
  const evalScripts = Object.fromEntries(
    Object.entries(headPkg.scripts ?? {}).filter(([k]) => k.startsWith('eval:suite')),
  );
  baselinePkg.scripts = { ...(baselinePkg.scripts ?? {}), ...evalScripts };
  writeFileSync(join(baselinePkgDir, 'package.json'), JSON.stringify(baselinePkg, null, 2), 'utf8');
}
