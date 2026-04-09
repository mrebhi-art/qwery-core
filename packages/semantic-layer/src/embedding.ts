// Lazy-loaded pipeline to avoid startup cost
 
let embedder: ((text: string, opts: object) => Promise<{ data: Float32Array }>) | null = null;

async function getEmbedder() {
  if (!embedder) {
    // Dynamic import so the heavy model only loads when first needed
    const { pipeline } = await import('@xenova/transformers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as any;
  }
  return embedder!;
}

export const EMBEDDING_DIMENSIONS = 384;

export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((t) => generateEmbedding(t)));
}

export function datasetEmbeddingText(dataset: {
  name: string;
  label?: string;
  description?: string;
  ai_context?: unknown;
}): string {
  const synonyms =
    dataset.ai_context &&
    typeof dataset.ai_context === 'object' &&
    'synonyms' in dataset.ai_context &&
    Array.isArray((dataset.ai_context as { synonyms: unknown }).synonyms)
      ? ((dataset.ai_context as { synonyms: string[] }).synonyms).join(' ')
      : '';

  return [dataset.name, dataset.label ?? '', dataset.description ?? '', synonyms]
    .filter(Boolean)
    .join(' ');
}
