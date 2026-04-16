import { runMultiTurn } from './multi-turn/main';

runMultiTurn().catch((error) => {
  console.error(
    '[internal-agent/multi-turn] failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
