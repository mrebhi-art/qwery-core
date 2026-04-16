import type { BirdTask } from './bird-task';
import type {
  BirdAgentBehaviorMetrics,
  BirdCompositeEvaluation,
  BirdExecutionConfig,
  BirdExecutionEvaluation,
} from './bird-execution';

export type {
  BirdAgentBehaviorMetrics,
  BirdCompositeEvaluation,
  BirdExecutionConfig,
  BirdExecutionEvaluation,
};

export type BirdSplit = 'mini_dev_sqlite' | 'mini_dev_mysql' | 'mini_dev_pg';
export type BirdDifficulty = 'simple' | 'moderate' | 'challenging';

export type BirdExample = {
  id: string;
  dbId: string;
  question: string;
  goldenSql: string;
  evidence: string;
  difficulty: BirdDifficulty;
};

export type BirdMetricResult = {
  name: string;
  score: number;
  passed: boolean;
  detail?: string;
};

export type BirdCaseResult = {
  id: string;
  dbId: string;
  difficulty: BirdDifficulty;
  question: string;
  goldenSql: string;
  generatedOutput: string;
  extractedSql?: string;
  generatedTablePreview?: Array<Record<string, unknown>>;
  goldenTablePreview?: Array<Record<string, unknown>>;
  evaluation?: BirdCompositeEvaluation;
  agentBehavior?: BirdAgentBehaviorMetrics;
  score: number;
  passed: boolean;
  metrics: BirdMetricResult[];
  durationMs: number;
  error?: string;
};

export type BirdBenchmarkOptions = {
  tasks?: BirdTask[];
  split?: BirdSplit;
  limit?: number;
  difficulty?: BirdDifficulty[];
  includeEvidence?: boolean;
  execution?: BirdExecutionConfig;
};

export type BirdEvaluateOptions = {
  agentVersion?: string;
  datasetName?: string;
  baseUrl?: string;
  projectId?: string;
  concurrency?: number;
};

export type BirdBenchmarkMeta = {
  benchmarkId: 'bird';
  split: BirdSplit;
  tasks: string[];
  difficulty: BirdDifficulty[];
  exampleCount: number;
};
