type DatabaseRow = Record<string, unknown>;

function asRecord(row: unknown): DatabaseRow {
  return row && typeof row === 'object' && !Array.isArray(row) ? row as DatabaseRow : { value: row };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

function displayColumn(column: string): string {
  return column
    .replaceAll('_', ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function questionSubject(question: string, fallback: string): string {
  const subject = question
    .replace(/^(?:\s*)(?:how many|how much|what|which|show|list|find|count|tell me(?: about)?)\s+/i, '')
    .replace(/^(?:are there|is there|are|is|the|all|any)\s+/i, '')
    .replace(/^(?:the|all|any)\s+/i, '')
    .replace(/\s+(?:are there|is there|are|is|do we have|does|have|has)\b.*$/i, '')
    .replace(/[?.!,].*$/, '')
    .trim();

  return subject || fallback;
}

function singularize(subject: string): string {
  const irregular: Record<string, string> = {
    activities: 'activity',
    people: 'person',
  };
  return subject.replace(/[a-z]+/gi, (word) => {
    const lower = word.toLowerCase();
    if (irregular[lower]) return irregular[lower];
    if (lower.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (lower.endsWith('s') && !lower.endsWith('ss')) return word.slice(0, -1);
    return word;
  });
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function formatAggregate(question: string, sql: string, row: DatabaseRow): string | undefined {
  const values = Object.values(row);
  if (values.length !== 1) return undefined;

  const aggregate = sql.match(
  /\b(COUNT|AVG|SUM|MAX|MIN)\s*\(/i,)?.[1]?.toUpperCase();
  if (!aggregate) return undefined;

  const value = values[0];
  if (aggregate === 'COUNT') {
    const count = numericValue(value);
    if (count === undefined) return undefined;
    const subject = questionSubject(question, 'records');
    return `${count === 1 ? 'There is' : 'There are'} ${count} ${count === 1 ? singularize(subject) : subject}.`;
  }

  const numeric = numericValue(value);
  if ((aggregate === 'AVG' || aggregate === 'SUM') && numeric === undefined) return undefined;
  const label = aggregate === 'AVG' ? 'Average' : aggregate === 'SUM' ? 'Total' : aggregate === 'MAX' ? 'Maximum' : 'Minimum';
  return `${label}: ${numeric === undefined ? displayValue(value) : numeric}.`;
}

function formatProjectList(question: string, sql: string, rows: DatabaseRow[]): string | undefined {
  if (!/\bFROM\s+(?:dbo\.)?projects\b/i.test(sql)) return undefined;

  const nameColumn = Object.keys(rows[0] ?? {}).find((column) => /^(?:project_)?name$/i.test(column));
  if (!nameColumn) return undefined;

  const names = rows.map((row) => row[nameColumn]).filter((name): name is string => typeof name === 'string');
  if (names.length === 0) return undefined;

  const subject = questionSubject(question, 'projects');
  const shownNames = names.slice(0, 12).join(', ');
  const remaining = names.length - Math.min(names.length, 12);
  const suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return `${names.length === 1 ? 'There is' : 'There are'} ${names.length} ${names.length === 1 ? singularize(subject) : subject}: ${shownNames}${suffix}.`;
}

export function formatDatabaseAnswer(question: string, sql: string, rows: unknown[]): string {
  if (rows.length === 0) return 'No matching records were found.';

  const records = rows.map(asRecord);
  if (records.length === 1) {
    const aggregate = formatAggregate(question, sql, records[0]);
    if (aggregate) return aggregate;
  }

  const projectList = formatProjectList(question, sql, records);
  if (projectList) return projectList;

  const columns = Object.keys(records[0]);
  if (columns.length === 0) return `${records.length} matching records found.`;

  if (columns.length === 1) {
    const values = records.slice(0, 10).map((row) => displayValue(row[columns[0]]));
    const remaining = records.length - values.length;
    const suffix = remaining > 0 ? `; and ${remaining} more` : '';
    return `${displayColumn(columns[0])}: ${values.join(', ')}${suffix}.`;
  }

  if (records.length === 1) {
    return columns.map((column) => `${displayColumn(column)}: ${displayValue(records[0][column])}`).join('; ') + '.';
  }

  const displayedRecords = records.slice(0, 10);
  const lines = [
    columns.map(displayColumn).join(' | '),
    ...displayedRecords.map((row) => columns.map((column) => displayValue(row[column])).join(' | ')),
  ];
  if (records.length > displayedRecords.length) lines.push(`...and ${records.length - displayedRecords.length} more rows.`);
  return lines.join('\n');
}