export function extractSqlFromText(text: string): string {
  if (!text) return text;

  const trimmed = text.trim();

  const cleanSql = (sql: string): string =>
    sql
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\s+$/gm, '')
      .trim();

  const stripKnownArtifacts = (value: string): string =>
    value
      .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, ' ')
      .replace(/<invoke\b[\s\S]*?<\/invoke>/gi, ' ')
      .replace(/<\/?[a-z_][a-z0-9:_-]*\b[^>]*>/gi, ' ')
      .replace(/\{\s*"datasourceId"[\s\S]*?\}(?=\s*[A-Z]|$)/g, ' ')
      .replace(/\{\s*"exportFilename"[\s\S]*?\}(?=\s*[A-Z]|$)/g, ' ')
      .replace(/\{\s*"query"[\s\S]*?\}(?=\s*[A-Z]|$)/g, ' ');

  const findSqlStart = (value: string): number => {
    const starts: number[] = [];
    const statementRegex = /(?:^|\n)\s*(SELECT|INSERT|UPDATE|DELETE)\b/gi;
    const withRegex = /(?:^|\n)\s*WITH\s+[a-z_][a-z0-9_]*\s+AS\s*\(/gi;

    for (const match of value.matchAll(statementRegex)) {
      if (match.index != null) starts.push(match.index + match[0].indexOf(match[1]!));
    }
    for (const match of value.matchAll(withRegex)) {
      if (match.index != null) starts.push(match.index + match[0].toUpperCase().indexOf('WITH'));
    }

    if (starts.length === 0) return -1;

    const ranked = starts
      .map((start) => {
        const sample = value.slice(start, start + 200);
        const firstLine = sample.split('\n')[0]?.trim() ?? '';
        let score = 0;
        if (/\b(FROM|INTO|SET)\b/i.test(sample)) score += 4;
        if (/\b(LET ME|I NEED|UNDERSTAND|ACTUALLY|NOW I)\b/i.test(sample)) score -= 4;
        if (/[.:]$/.test(firstLine) && !/\b(FROM|INTO|SET)\b/i.test(firstLine)) score -= 3;
        const nextStart = sample.slice(1).match(/\n\s*(SELECT|WITH)\b/i);
        if (nextStart && !/\b(FROM|INTO|SET)\b/i.test(firstLine)) score -= 2;
        return { start, score };
      })
      .sort((a, b) => b.score - a.score || a.start - b.start);

    return ranked[0]?.start ?? -1;
  };

  const cutTrailingNonSql = (sqlTail: string): string => {
    const earlyNestedStart = sqlTail
      .slice(1, 160)
      .match(/\n\s*(SELECT|WITH)\b/i);
    if (
      earlyNestedStart &&
      !/\b(FROM|INTO|SET)\b/i.test(sqlTail.split('\n')[0] ?? '')
    ) {
      return cutTrailingNonSql(sqlTail.slice((earlyNestedStart.index ?? 0) + 1).trimStart());
    }

    const cutPatterns = [
      /<minimax:/i,
      /<invoke\b/i,
      /\n\s*</,
      /\n\s*\{/,
      /",\s*"(?:exportFilename|datasourceId|query|result|rows|columns)"\s*:/i,
      /"\}\s*[A-Z]/,
      /\}\s*The query returned/i,
      /\}\s*Let me\b/i,
      /\n\s*Let me\b/i,
      /\n\s*Actually,\s/i,
      /\n\s*Now I\b/i,
      /\n\s*The query returned/i,
    ];

    let cutIndex = -1;
    for (const pattern of cutPatterns) {
      const match = pattern.exec(sqlTail);
      if (match?.index != null) {
        cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
      }
    }

    return cutIndex === -1 ? sqlTail : sqlTail.slice(0, cutIndex);
  };

  const sanitized = stripKnownArtifacts(trimmed);

  const parseSqlFromJson = (value: string): string | null => {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      for (const key of ['generatedSql', 'query', 'sql', 'sql_query']) {
        const candidate = parsed[key];
        if (typeof candidate === 'string' && /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(candidate)) {
          return cleanSql(candidate);
        }
      }
      if (typeof parsed['text'] === 'string') {
        const nested = extractSqlFromText(parsed['text']);
        if (nested && nested !== parsed['text']) return cleanSql(nested);
      }
      return null;
    } catch {
      return null;
    }
  };

  // 0) Direct JSON payload output from harness or agent wrappers.
  const directJson = parseSqlFromJson(sanitized);
  if (directJson) return directJson;

  // 0b) JSON object embedded in a longer response.
  const firstObj = sanitized.indexOf('{');
  const lastObj = sanitized.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    const embeddedJson = parseSqlFromJson(sanitized.slice(firstObj, lastObj + 1));
    if (embeddedJson) return embeddedJson;
  }

  // 1. Fenced code blocks with `sql` or empty
  const fencedRegex = /```(?:sql)?\s*([\s\S]*?)\s*```/i;
  const fencedMatch = RegExp(fencedRegex).exec(sanitized);
  if (fencedMatch && fencedMatch[1]) {
    return cleanSql(fencedMatch[1]);
  }

  // 2. Inline backticks if they contain SELECT, INSERT, UPDATE, etc.
  const inlineRegex = /`([^`]+)`/g;
  let match;
  while ((match = inlineRegex.exec(sanitized)) !== null) {
    const content = match[1]?.trim() || '';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(content)) {
      return cleanSql(content);
    }
  }

  // 3. Keyword-based scanning (prefer actual SQL starts, avoid prose like "with the best...")
  const start = findSqlStart(sanitized);
  if (start !== -1) {
    const tail = cutTrailingNonSql(sanitized.slice(start));
    const cut = tail.search(/(?:```|\n\s*\{\s*"|"\s*,\s*"(?:description|datasource|results|rows)"\s*:)/i);
    return cleanSql(cut === -1 ? tail : tail.slice(0, cut));
  }

  // 4. Fallback to original text
  return sanitized.trim();
}
