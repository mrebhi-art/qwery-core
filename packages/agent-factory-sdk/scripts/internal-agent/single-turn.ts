import { runSingleTurn } from './single-turn/main';

runSingleTurn().catch((error) => {
  console.error(
    '[internal-agent/single-turn] failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});