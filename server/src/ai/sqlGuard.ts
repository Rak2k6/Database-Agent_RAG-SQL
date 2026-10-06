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
  // Data modification
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',

  // Schema / database modification
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'COMMENT',

  // Permissions / administration
  'GRANT',
  'REVOKE',
  'DENY',
  'BACKUP',
  'RESTORE',
  'DBCC',
  'SHUTDOWN',

  // PostgreSQL-specific execution / modification
  'COPY',
  'CALL',
  'DO',
  'EXECUTE',
  'REFRESH',

  // SQL Server execution / dynamic SQL
  'EXEC',
  'SP_EXECUTESQL',

  // Query constructs that can write into objects
  'INTO',

  // Database switching / server-side waiting
  'USE',
  'WAITFOR',
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

    // Single-line comment
    if (sql.startsWith('--', index)) {
      const lineEnd = sql.indexOf('\n', index + 2);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    // Block comment
    if (sql.startsWith('/*', index)) {
      const commentEnd = sql.indexOf('*/', index + 2);

      if (commentEnd === -1) {
        throw new Error('SQL contains an unterminated comment.');
      }

      index = commentEnd + 2;
      continue;
    }

    // String literal
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

      if (!closed) {
        throw new Error('SQL contains an unterminated string.');
      }

      tokens.push({
        value: sql.slice(start, index),
        kind: 'string',
      });

      continue;
    }

    // Quoted identifier: "name", `name`, [name]
    if (character === '"' || character === '`' || character === '[') {
      const closingCharacter =
        character === '[' ? ']' : character;

      index += 1;

      let value = '';
      let closed = false;

      while (index < sql.length) {
        if (
          sql[index] === closingCharacter &&
          sql[index + 1] === closingCharacter &&
          character !== '['
        ) {
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

      if (!closed) {
        throw new Error(
          'SQL contains an unterminated quoted identifier.',
        );
      }

      tokens.push({
        value,
        kind: 'identifier',
      });

      continue;
    }

    // Word / identifier
    if (/[a-zA-Z_]/.test(character)) {
      const start = index++;

      while (
        index < sql.length &&
        /[a-zA-Z0-9_$]/.test(sql[index])
      ) {
        index += 1;
      }

      tokens.push({
        value: sql.slice(start, index),
        kind: 'word',
      });

      continue;
    }

    tokens.push({
      value: character,
      kind: 'symbol',
    });

    index += 1;
  }

  return tokens;
}

function isWord(
  token: SqlToken | undefined,
  value: string,
): boolean {
  return (
    token?.kind === 'word' &&
    token.value.toUpperCase() === value
  );
}

function assertAllowedTable(
  tokens: SqlToken[],
  tableIndex: number,
): void {
  const table = tokens[tableIndex];

  if (
    !table ||
    (table.kind !== 'word' && table.kind !== 'identifier')
  ) {
    throw new Error(
      'Only explicitly allowed database tables may be queried.',
    );
  }

  // Unqualified table: projects
  if (tokens[tableIndex + 1]?.value !== '.') {
    const tableName = table.value.toLowerCase();

    if (!ALLOWED_TABLES.has(tableName)) {
      throw new Error(`Table ${tableName} is not allowed.`);
    }

    return;
  }

  // Qualified table: dbo.projects
  if (table.value.toLowerCase() !== 'dbo') {
    throw new Error(
      'Only the dbo schema is allowed.',
    );
  }

  const actualTable = tokens[tableIndex + 2];

  if (
    !actualTable ||
    (actualTable.kind !== 'word' &&
      actualTable.kind !== 'identifier')
  ) {
    throw new Error(
      'Only explicitly allowed database tables may be queried.',
    );
  }

  const tableName = actualTable.value.toLowerCase();

  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Table ${tableName} is not allowed.`);
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

  // Only one statement is allowed.
  const semicolonIndexes = tokens.flatMap(
    (token, index) =>
      token.value === ';' ? [index] : [],
  );

  if (
    semicolonIndexes.length > 1 ||
    (
      semicolonIndexes.length === 1 &&
      semicolonIndexes[0] !== tokens.length - 1
    )
  ) {
    throw new Error(
      'Multiple SQL statements are not allowed.',
    );
  }

  // Block all known write/admin/execution keywords.
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (
      tokens.some(
        (token) =>
          token.kind === 'word' &&
          token.value.toUpperCase() === keyword,
      )
    ) {
      throw new Error(
        `SQL keyword ${keyword} is not allowed.`,
      );
    }
  }

  /*
   * Track parenthesis depth so that table detection only
   * applies to actual FROM/JOIN clauses.
   */
  const depths: number[] = [];
  let depth = 0;

  for (const token of tokens) {
    depths.push(depth);

    if (token.value === '(') {
      depth += 1;
    }

    if (token.value === ')') {
      depth = Math.max(0, depth - 1);
    }
  }

  const fromClauseEnd = new Set([
    'WHERE',
    'GROUP',
    'ORDER',
    'TOP',
    'HAVING',
    'WINDOW',
    'UNION',
    'EXCEPT',
    'INTERSECT',
    'OFFSET',
    'FETCH',
  ]);

  for (
    let index = 0;
    index < tokens.length;
    index += 1
  ) {
    if (
      !isWord(tokens[index], 'FROM') &&
      !isWord(tokens[index], 'JOIN')
    ) {
      continue;
    }

    const tableIndex = index + 1;

    // Derived tables / subqueries require additional parsing.
    // Do not silently allow them to bypass the table allowlist.
    if (tokens[tableIndex]?.value === '(') {
      throw new Error(
        'Subqueries in FROM/JOIN clauses are not allowed.',
      );
    }

    assertAllowedTable(tokens, tableIndex);

    if (isWord(tokens[index], 'FROM')) {
      for (
        let cursor = tableIndex + 1;
        cursor < tokens.length;
        cursor += 1
      ) {
        if (
          depths[cursor] === depths[index] &&
          tokens[cursor].kind === 'word' &&
          fromClauseEnd.has(
            tokens[cursor].value.toUpperCase(),
          )
        ) {
          break;
        }

        if (
          depths[cursor] === depths[index] &&
          tokens[cursor].value === ','
        ) {
          assertAllowedTable(tokens, cursor + 1);
        }
      }
    }
  }
}