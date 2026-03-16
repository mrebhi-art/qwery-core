import Papa from 'papaparse';

export function isValidCsv(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }
  const parsed = Papa.parse(trimmed, { preview: 5 });
  return (
    Array.isArray(parsed.data) &&
    parsed.data.length > 0 &&
    (parsed.meta?.delimiter ?? '').length > 0
  );
}
