export function toFtsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}
