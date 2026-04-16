const DEFAULT_QUESTIONS: string[] = [
  'Summarize the dataset in one paragraph.',
  'What are the top 3 ship modes by count?',
  'Now show percentages for each ship mode.',
  'Which ship mode appears least often, and by how much compared to the top mode?',
  'Create a chart for the distribution of ship modes.',
  'Based on this, give me two practical business recommendations.',
];

function parseQuestionArray(rawJson: string): string[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);
  } catch {
    return [];
  }
}

export function readQuestions(): string[] {
  const rawJson =
    process.env['MULTI_TURN_QUESTIONS_JSON'] ??
    process.env['QWERY_MULTI_TURN_QUESTIONS_JSON'];

  if (rawJson && rawJson.trim().length > 0) {
    const questions = parseQuestionArray(rawJson);
    if (questions.length > 0) {
      return questions;
    }
  }

  const rawMultiline =
    process.env['MULTI_TURN_QUESTIONS'] ??
    process.env['QWERY_MULTI_TURN_QUESTIONS'];

  if (rawMultiline && rawMultiline.trim().length > 0) {
    const questions = rawMultiline
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);
    if (questions.length > 0) {
      return questions;
    }
  }

  return DEFAULT_QUESTIONS;
}
