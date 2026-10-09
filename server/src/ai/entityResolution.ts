/**
 * Database-backed person/project name resolution shared by the legacy
 * pipeline and the experimental LLM-first pipeline.
 *
 * Moved verbatim out of databaseQuery.ts so both pipelines reuse the exact
 * same resolution behaviour (including ambiguous-name clarification) without
 * introducing circular imports. Legacy behaviour is unchanged.
 */
import { executeReadOnlySql } from './sqlExecutor.js';

export type NamedEntity = { id: string; name: string };
export type NameResolution = { match?: NamedEntity; candidates: string[] };

export function sqlString(value: string): string { return "N'" + value.replace(/'/g, "''") + "'"; }

export async function resolveName(table: 'users' | 'projects', reference: string): Promise<NameResolution> {
  const value = sqlString(reference.trim());
  const rows = await executeReadOnlySql(
    'SELECT TOP 20 id AS id, name AS name FROM dbo.' + table +
      ' WHERE CHARINDEX(LOWER(' + value + '), LOWER(name)) > 0' +
      ' ORDER BY CASE WHEN LOWER(LTRIM(RTRIM(name))) = LOWER(' + value + ') THEN 0 ELSE 1 END, name',
  );
  const matches = rows.flatMap((row): NamedEntity[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    return typeof record['id'] === 'string' && typeof record['name'] === 'string'
      ? [{ id: record['id'], name: record['name'] }]
      : [];
  });
  const exact = matches.filter((match) => match.name.trim().toLocaleLowerCase() === reference.trim().toLocaleLowerCase());
  const candidates = exact.length ? exact : matches;
  return candidates.length === 1
    ? { match: candidates[0], candidates: candidates.map((candidate) => candidate.name) }
    : { candidates: candidates.map((candidate) => candidate.name) };
}

export function clarifyOrNotFound(kind: 'person' | 'project', reference: string, candidates: string[]): string {
  if (!candidates.length) return kind === 'person'
    ? 'I could not find a workspace team member named "' + reference + '".'
    : 'I could not find a project named "' + reference + '".';
  const choices = candidates.slice(0, 10).map((name) => '- ' + name).join('\n');
  return 'I found more than one ' + kind + ' matching "' + reference + '":\n' + choices + '\nWhich one did you mean?';
}
