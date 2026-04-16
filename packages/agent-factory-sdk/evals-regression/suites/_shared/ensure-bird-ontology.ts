import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const completedBuilds = new Set<string>();

function collectBunEnvFileArgs(packageRoot: string): string[] {
  const candidates = ['.env', '.env.local', '.env.development'];
  const args: string[] = [];

  for (const name of candidates) {
    const path = resolve(packageRoot, name);
    if (existsSync(path)) {
      args.push('--env-file', path);
    }
  }

  return args;
}

function splitModel(model: string): { provider: string; modelName: string } {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) {
    return { provider: 'ollama-cloud', modelName: 'minimax-m2.5' };
  }

  return {
    provider: model.slice(0, slashIndex),
    modelName: model.slice(slashIndex + 1),
  };
}

export async function ensureBirdOntologyForDataset(
  dataset: string,
  model: string,
): Promise<void> {
  if (process.env['BIRD_BUILD_ONTOLOGY'] === '0') {
    return;
  }

  const force = process.env['BIRD_FORCE_REBUILD'] === '1';
  const buildKey = `${dataset}::${model}::${force ? 'force' : 'reuse'}`;
  if (completedBuilds.has(buildKey)) {
    return;
  }

  const { provider, modelName } = splitModel(model);

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(currentDir, '..', '..', '..');
  const scriptPath = resolve(
    packageRoot,
    'scripts',
    'internal-agent',
    'build-bird-ontology.ts',
  );
  const bunArgs = [...collectBunEnvFileArgs(packageRoot), scriptPath, '--dataset', dataset];

  await new Promise<void>((resolveDone, reject) => {
    const child = spawn('bun', bunArgs, {
      cwd: packageRoot,
      env: {
        ...process.env,
        BIRD_MODEL: model,
        EVAL_MODEL: process.env['EVAL_MODEL'] ?? model,
        MODEL: process.env['MODEL'] ?? model,
        AGENT_PROVIDER: process.env['AGENT_PROVIDER'] ?? provider,
        LLM_DEFAULT_PROVIDER: process.env['LLM_DEFAULT_PROVIDER'] ?? provider,
        OLLAMA_MODEL: process.env['OLLAMA_MODEL'] ?? modelName,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolveDone();
        return;
      }

      reject(
        new Error(
          `build-bird-ontology exited with code ${code}. stderr:\n${stderr}\nstdout:\n${stdout}`,
        ),
      );
    });
  });

  completedBuilds.add(buildKey);
}
