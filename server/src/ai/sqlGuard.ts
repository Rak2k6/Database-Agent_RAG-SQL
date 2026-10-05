const ALLOWED_TABLES = new Set([
  'projects',
  'project_members',
  'tasks',
  'users',
  'documents',
  'calendar_events',
  'activities',
  'notifications',
]);

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'REPLACE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
];

interface SqlToken {
  value: string;
  kind: 'word' | 'identifier' | 'string' | 'symbol';
}

function tokenize(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (sql.startsWith('--', index)) {
      const lineEnd = sql.indexOf('\n', index + 2);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      const commentEnd = sql.indexOf('*/', index + 2);
      if (commentEnd === -1) throw new Error('SQL contains an unterminated comment.');
      index = commentEnd + 2;
      continue;
    }

    if (character === "'") {
      const start = index++;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error('SQL contains an unterminated string.');
      tokens.push({ value: sql.slice(start, index), kind: 'string' });
      continue;
    }

    if (character === '"' || character === '`' || character === '[') {
      const closingCharacter = character === '[' ? ']' : character;
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === closingCharacter && sql[index + 1] === closingCharacter && character !== '[') {
          value += closingCharacter;
          index += 2;
        } else if (sql[index] === closingCharacter) {
          index += 1;
          closed = true;
          break;
        } else {
          value += sql[index];
          index += 1;
        }
      }
      if (!closed) throw new Error('SQL contains an unterminated quoted identifier.');
      tokens.push({ value, kind: 'identifier' });
      continue;
    }

    if (/[a-zA-Z_]/.test(character)) {
      const start = index++;
      while (index < sql.length && /[a-zA-Z0-9_$]/.test(sql[index])) index += 1;
      tokens.push({ value: sql.slice(start, index), kind: 'word' });
      continue;
    }

    tokens.push({ value: character, kind: 'symbol' });
    index += 1;
  }

  return tokens;
}

function isWord(token: SqlToken | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value.toUpperCase() === value;
}

function assertAllowedTable(tokens: SqlToken[], tableIndex: number): void {
  const table = tokens[tableIndex];
  if (!table || (table.kind !== 'word' && table.kind !== 'identifier')) {
    throw new Error('Only explicitly allowed database tables may be queried.');
  }

  const tableName = table.value.toLowerCase();
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Table ${tableName} is not allowed.`);
  }

  if (tokens[tableIndex + 1]?.value === '.') {
    throw new Error('Qualified table names are not allowed.');
  }
}

export function validateReadOnlySql(sql: string): void {
  const tokens = tokenize(sql);
  if (tokens.length === 0) {
    throw new Error('SQL query is empty.');
  }

  if (!isWord(tokens[0], 'SELECT')) {
    throw new Error('Only SELECT queries are allowed.');
  }

  const semicolonIndexes = tokens.flatMap((token, index) => token.value === ';' ? [index] : []);
  if (semicolonIndexes.length > 1 || (semicolonIndexes.length === 1 && semicolonIndexes[0] !== tokens.length - 1)) {
    throw new Error('Multiple SQL statements are not allowed.');
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (tokens.some((token) => token.kind === 'word' && token.value.toUpperCase() === keyword)) {
      throw new Error(`SQL keyword ${keyword} is not allowed.`);
    }
  }

  const depths: number[] = [];
  let depth = 0;
  for (const token of tokens) {
    depths.push(depth);
    if (token.value === '(') depth += 1;
    if (token.value === ')') depth = Math.max(0, depth - 1);
  }

  const fromClauseEnd = new Set(['WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT']);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isWord(tokens[index], 'FROM') && !isWord(tokens[index], 'JOIN')) continue;

    const tableIndex = index + 1;
    if (tokens[tableIndex]?.value !== '(') assertAllowedTable(tokens, tableIndex);

    if (isWord(tokens[index], 'FROM')) {
      for (let cursor = tableIndex + 1; cursor < tokens.length; cursor += 1) {
        if (depths[cursor] === depths[index] && tokens[cursor].kind === 'word' && fromClauseEnd.has(tokens[cursor].value.toUpperCase())) break;
        if (depths[cursor] === depths[index] && tokens[cursor].value === ',') {
          assertAllowedTable(tokens, cursor + 1);
        }
      }
    }
  }
}