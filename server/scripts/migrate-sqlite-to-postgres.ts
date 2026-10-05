import Database from 'better-sqlite3';
import { Client } from 'pg';
import path from 'path';

const PG_URI =
  process.env.PG_URI ||
  'postgresql://postgres:postgres@localhost:5432/NorthStarAI';

const SQLITE_PATH = path.resolve(
  process.cwd(),
  'server/data/northstar.sqlite'
);

type Row = Record<string, unknown>;

type TableSummary = {
  sqlite: number;
  postgres: number;
  pass: boolean;
};

/**
 * Explicit column mappings.
 *
 * Keeping these explicit makes the migration deterministic and prevents
 * accidental dependence on SQLite column ordering.
 */
const TABLES = {
  users: [
    'id',
    'name',
    'email',
    'password_hash',
    'auth_provider',
    'google_id',
    'profile_image',
    'role',
    'department',
    'status',
    'created_at',
    'updated_at',
  ],

  projects: [
    'id',
    'name',
    'description',
    'status',
    'start_date',
    'due_date',
    'created_by',
    'created_at',
    'updated_at',
  ],

  project_members: [
    'project_id',
    'user_id',
    'role',
  ],

  tasks: [
    'id',
    'title',
    'description',
    'project_id',
    'assigned_to',
    'created_by',
    'priority',
    'status',
    'due_date',
    'created_at',
    'updated_at',
    'completed_at',
  ],

  calendar_events: [
    'id',
    'title',
    'description',
    'start_time',
    'end_time',
    'event_type',
    'created_by',
    'project_id',
    'created_at',
  ],

  documents: [
    'id',
    'name',
    'file_name',
    'file_path',
    'file_type',
    'file_size',
    'uploaded_by',
    'project_id',
    'folder',
    'created_at',
    'updated_at',
  ],

  activities: [
    'id',
    'user_id',
    'action',
    'entity_type',
    'entity_id',
    'subject',
    'created_at',
  ],

  notifications: [
    'id',
    'user_id',
    'title',
    'message',
    'type',
    'is_read',
    'created_at',
  ],

  user_settings: [
    'user_id',
    'theme',
    'notify_task_assignments',
    'notify_project_updates',
    'notify_upcoming_meetings',
    'notify_deadline_reminders',
    'updated_at',
  ],

  password_reset_tokens: [
    'token_hash',
    'user_id',
    'expires_at',
    'used_at',
  ],

  sessions: [
    'token_hash',
    'user_id',
    'expires_at',
    'created_at',
  ],
} as const;

type TableName = keyof typeof TABLES;

const MIGRATION_ORDER: TableName[] = [
  'users',
  'projects',
  'project_members',
  'tasks',
  'calendar_events',
  'documents',
  'activities',
  'notifications',
  'user_settings',
  'password_reset_tokens',
  'sessions',
];

/**
 * Columns that are PostgreSQL TIMESTAMPTZ.
 *
 * SQLite stores these as TEXT in the existing database.
 */
const TIMESTAMPTZ_COLUMNS: Record<string, Set<string>> = {
  users: new Set(['created_at', 'updated_at']),

  projects: new Set([
    'start_date',
    'due_date',
    'created_at',
    'updated_at',
  ]),

  tasks: new Set([
    'due_date',
    'created_at',
    'updated_at',
    'completed_at',
  ]),

  calendar_events: new Set([
    'start_time',
    'end_time',
    'created_at',
  ]),

  documents: new Set([
    'created_at',
    'updated_at',
  ]),

  activities: new Set([
    'created_at',
  ]),

  notifications: new Set([
    'created_at',
  ]),

  user_settings: new Set([
    'updated_at',
  ]),
};

/**
 * Authentication timestamps intentionally remain BIGINT.
 *
 * These are Unix timestamps in milliseconds produced by Date.now().
 */
const BIGINT_COLUMNS: Record<string, Set<string>> = {
  password_reset_tokens: new Set([
    'expires_at',
    'used_at',
  ]),

  sessions: new Set([
    'expires_at',
    'created_at',
  ]),
};

/**
 * SQLite INTEGER booleans that become PostgreSQL BOOLEAN.
 */
const BOOLEAN_COLUMNS: Record<string, Set<string>> = {
  notifications: new Set([
    'is_read',
  ]),

  user_settings: new Set([
    'notify_task_assignments',
    'notify_project_updates',
    'notify_upcoming_meetings',
    'notify_deadline_reminders',
  ]),
};

/**
 * Convert SQLite date strings to values PostgreSQL can safely store
 * as TIMESTAMPTZ.
 *
 * PostgreSQL's node driver can handle Date objects directly.
 *
 * NULL remains NULL.
 */
function convertTimestamp(
  value: unknown,
  table: string,
  column: string
): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error(
      `Invalid TIMESTAMPTZ value in ${table}.${column}: ${String(value)}`
    );
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid date in ${table}.${column}: ${value}`
    );
  }

  return date;
}

/**
 * Convert a single SQLite row into PostgreSQL-compatible values.
 */
function transformRow(
  table: TableName,
  row: Row
): unknown[] {
  return TABLES[table].map((column) => {
    const value = row[column];

    // Preserve SQL NULL.
    if (value === null || value === undefined) {
      return null;
    }

    // PostgreSQL TIMESTAMPTZ.
    if (TIMESTAMPTZ_COLUMNS[table]?.has(column)) {
      return convertTimestamp(value, table, column);
    }

    // SQLite INTEGER 0/1 → PostgreSQL BOOLEAN.
    if (BOOLEAN_COLUMNS[table]?.has(column)) {
      if (value === 0 || value === false) {
        return false;
      }

      if (value === 1 || value === true) {
        return true;
      }

      throw new Error(
        `Invalid boolean value in ${table}.${column}: ${String(value)}`
      );
    }

    // Authentication timestamps remain BIGINT exactly as stored.
    if (BIGINT_COLUMNS[table]?.has(column)) {
      if (typeof value === 'number') {
        return value;
      }

      if (typeof value === 'bigint') {
        return value.toString();
      }

      if (typeof value === 'string' && /^\d+$/.test(value)) {
        return value;
      }

      throw new Error(
        `Invalid BIGINT value in ${table}.${column}: ${String(value)}`
      );
    }

    return value;
  });
}

/**
 * Quote an identifier.
 *
 * Identifiers are hard-coded by this migration, but quoting them makes
 * the generated SQL safer and PostgreSQL-compatible.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Build a deterministic INSERT statement for a table.
 */
function buildInsertQuery(table: TableName): string {
  const columns = TABLES[table];

  const columnNames = columns
    .map(quoteIdentifier)
    .join(', ');

  const placeholders = columns
    .map((_, index) => `$${index + 1}`)
    .join(', ');

  return `
    INSERT INTO ${quoteIdentifier(table)}
      (${columnNames})
    VALUES
      (${placeholders})
  `;
}

/**
 * Read all rows from SQLite using the explicit column order.
 */
function readSQLiteRows(
  sqliteDb: Database.Database,
  table: TableName
): Row[] {
  const columns = TABLES[table]
    .map(quoteIdentifier)
    .join(', ');

  const query = `
    SELECT ${columns}
    FROM ${quoteIdentifier(table)}
  `;

  return sqliteDb.prepare(query).all() as Row[];
}

/**
 * Count rows in PostgreSQL independently from the insertion counter.
 */
async function countPostgresRows(
  pgClient: Client,
  table: TableName
): Promise<number> {
  const result = await pgClient.query(
    `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`
  );

  return Number(result.rows[0].count);
}

/**
 * Verify that the migration is targeting the expected PostgreSQL DB.
 */
async function verifyTargetDatabase(
  pgClient: Client
): Promise<void> {
  const result = await pgClient.query(`
    SELECT
      current_database() AS database_name,
      current_schema() AS schema_name
  `);

  const databaseName = result.rows[0].database_name;
  const schemaName = result.rows[0].schema_name;

  console.log(
    `Connected to PostgreSQL database: ${databaseName}`
  );

  console.log(
    `Current schema: ${schemaName}`
  );

  if (databaseName !== 'NorthStarAI') {
    throw new Error(
      `Safety check failed: expected database "NorthStarAI" but connected to "${databaseName}".`
    );
  }

  if (schemaName !== 'public') {
    throw new Error(
      `Safety check failed: expected schema "public" but connected to "${schemaName}".`
    );
  }
}

/**
 * Verify all expected target tables exist.
 */
async function verifyTargetTables(
  pgClient: Client
): Promise<void> {
  const result = await pgClient.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [MIGRATION_ORDER]
  );

  const existingTables = new Set(
    result.rows.map((row) => row.table_name)
  );

  const missingTables = MIGRATION_ORDER.filter(
    (table) => !existingTables.has(table)
  );

  if (missingTables.length > 0) {
    throw new Error(
      `Missing PostgreSQL tables: ${missingTables.join(', ')}`
    );
  }
}

/**
 * Verify all target tables are empty before migration.
 */
async function verifyTargetTablesAreEmpty(
  pgClient: Client
): Promise<void> {
  console.log('\nChecking that PostgreSQL target tables are empty...');

  for (const table of MIGRATION_ORDER) {
    const count = await countPostgresRows(pgClient, table);

    console.log(`  ${table}: ${count}`);

    if (count !== 0) {
      throw new Error(
        `Target table "${table}" is not empty (${count} rows). ` +
        `Migration requires a fresh/empty schema.`
      );
    }
  }
}

/**
 * Validate FK relationships using NOT EXISTS.
 *
 * This avoids NULL semantics associated with NOT IN.
 */
async function validateOrphans(
  pgClient: Client
): Promise<void> {
  console.log('\nValidating foreign-key relationships...');

  const checks = [
    {
      name: 'password_reset_tokens.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM password_reset_tokens child
        WHERE child.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.user_id
          )
      `,
    },

    {
      name: 'sessions.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM sessions child
        WHERE child.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.user_id
          )
      `,
    },

    {
      name: 'projects.created_by → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM projects child
        WHERE child.created_by IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.created_by
          )
      `,
    },

    {
      name: 'project_members.project_id → projects.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM project_members child
        WHERE NOT EXISTS (
          SELECT 1
          FROM projects parent
          WHERE parent.id = child.project_id
        )
      `,
    },

    {
      name: 'project_members.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM project_members child
        WHERE NOT EXISTS (
          SELECT 1
          FROM users parent
          WHERE parent.id = child.user_id
        )
      `,
    },

    {
      name: 'tasks.project_id → projects.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM tasks child
        WHERE child.project_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projects parent
            WHERE parent.id = child.project_id
          )
      `,
    },

    {
      name: 'tasks.assigned_to → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM tasks child
        WHERE child.assigned_to IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.assigned_to
          )
      `,
    },

    {
      name: 'tasks.created_by → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM tasks child
        WHERE child.created_by IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.created_by
          )
      `,
    },

    {
      name: 'calendar_events.created_by → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM calendar_events child
        WHERE child.created_by IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.created_by
          )
      `,
    },

    {
      name: 'calendar_events.project_id → projects.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM calendar_events child
        WHERE child.project_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projects parent
            WHERE parent.id = child.project_id
          )
      `,
    },

    {
      name: 'documents.uploaded_by → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM documents child
        WHERE child.uploaded_by IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.uploaded_by
          )
      `,
    },

    {
      name: 'documents.project_id → projects.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM documents child
        WHERE child.project_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projects parent
            WHERE parent.id = child.project_id
          )
      `,
    },

    {
      name: 'activities.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM activities child
        WHERE child.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.user_id
          )
      `,
    },

    {
      name: 'notifications.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM notifications child
        WHERE child.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.user_id
          )
      `,
    },

    {
      name: 'user_settings.user_id → users.id',
      query: `
        SELECT COUNT(*)::bigint AS count
        FROM user_settings child
        WHERE child.user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users parent
            WHERE parent.id = child.user_id
          )
      `,
    },
  ];

  for (const check of checks) {
    const result = await pgClient.query(check.query);
    const count = Number(result.rows[0].count);

    if (count !== 0) {
      throw new Error(
        `Orphan validation failed for ${check.name}: ${count} orphaned record(s).`
      );
    }

    console.log(`  PASS: ${check.name}`);
  }
}

/**
 * Independently compare SQLite and PostgreSQL row counts.
 */
async function verifyRowCounts(
  sqliteDb: Database.Database,
  pgClient: Client
): Promise<Record<string, TableSummary>> {
  console.log('\nVerifying final row counts...');

  const summary: Record<string, TableSummary> = {};

  for (const table of MIGRATION_ORDER) {
    const sqliteCount = sqliteDb
      .prepare(
        `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
      )
      .get() as { count: number };

    const sqliteRows = Number(sqliteCount.count);

    const postgresRows = await countPostgresRows(
      pgClient,
      table
    );

    const pass = sqliteRows === postgresRows;

    summary[table] = {
      sqlite: sqliteRows,
      postgres: postgresRows,
      pass,
    };

    console.log(
      `  ${table}: SQLite=${sqliteRows}, PostgreSQL=${postgresRows} ${pass ? 'PASS' : 'FAIL'}`
    );

    if (!pass) {
      throw new Error(
        `Row count mismatch for ${table}: SQLite=${sqliteRows}, PostgreSQL=${postgresRows}`
      );
    }
  }

  return summary;
}

/**
 * Main migration.
 */
async function migrate(): Promise<void> {
  console.log('==============================================');
  console.log(' Northstar SQLite → PostgreSQL Migration');
  console.log('==============================================');

  console.log(`SQLite source: ${SQLITE_PATH}`);
  console.log('PostgreSQL target: NorthStarAI');

  let sqliteDb: Database.Database | null = null;
  let pgClient: Client | null = null;
  let transactionStarted = false;

  try {
    // ------------------------------------------------------------
    // 1. Open SQLite source
    // ------------------------------------------------------------

    console.log('\nOpening SQLite source...');

    sqliteDb = new Database(SQLITE_PATH, {
      fileMustExist: true,
      readonly: true,
    });

    console.log('SQLite source opened successfully.');

    // ------------------------------------------------------------
    // 2. Connect PostgreSQL
    // ------------------------------------------------------------

    console.log('\nConnecting to PostgreSQL...');

    pgClient = new Client({
      connectionString: PG_URI,
    });

    await pgClient.connect();

    console.log('PostgreSQL connection established.');

    // ------------------------------------------------------------
    // 3. Safety checks
    // ------------------------------------------------------------

    await verifyTargetDatabase(pgClient);
    await verifyTargetTables(pgClient);
    await verifyTargetTablesAreEmpty(pgClient);

    // ------------------------------------------------------------
    // 4. Begin transaction
    // ------------------------------------------------------------

    console.log('\nBeginning PostgreSQL transaction...');

    await pgClient.query('BEGIN');
    transactionStarted = true;

    // ------------------------------------------------------------
    // 5. Prepare INSERT statements
    // ------------------------------------------------------------

    const insertQueries: Record<TableName, string> =
      {} as Record<TableName, string>;

    for (const table of MIGRATION_ORDER) {
      insertQueries[table] = buildInsertQuery(table);
    }

    // ------------------------------------------------------------
    // 6. Migrate tables
    // ------------------------------------------------------------

    console.log('\nStarting data migration...\n');

    for (const table of MIGRATION_ORDER) {
      console.log(`Migrating ${table}...`);

      const rows = readSQLiteRows(sqliteDb, table);
      const insertQuery = insertQueries[table];

      let inserted = 0;

      for (const row of rows) {
        const values = transformRow(table, row);

        await pgClient.query(insertQuery, values);

        inserted++;
      }

      console.log(
        `  ${table}: ${inserted} row(s) inserted`
      );
    }

    // ------------------------------------------------------------
    // 7. Validate row counts BEFORE commit
    // ------------------------------------------------------------

    const summary = await verifyRowCounts(
      sqliteDb,
      pgClient
    );

    // ------------------------------------------------------------
    // 8. Validate relationships BEFORE commit
    // ------------------------------------------------------------

    await validateOrphans(pgClient);

    // ------------------------------------------------------------
    // 9. Final summary
    // ------------------------------------------------------------

    console.log('\n==============================================');
    console.log(' Migration Validation Summary');
    console.log('==============================================');

    let allPassed = true;

    for (const table of MIGRATION_ORDER) {
      const result = summary[table];

      if (!result.pass) {
        allPassed = false;
      }

      console.log(
        `${table.padEnd(24)} ${String(result.sqlite).padStart(4)} → ${String(result.postgres).padStart(4)}  ${result.pass ? 'PASS' : 'FAIL'}`
      );
    }

    if (!allPassed) {
      throw new Error(
        'Migration validation failed. Transaction will be rolled back.'
      );
    }

    // ------------------------------------------------------------
    // 10. Commit
    // ------------------------------------------------------------

    console.log('\nAll migration checks passed.');
    console.log('Committing PostgreSQL transaction...');

    await pgClient.query('COMMIT');
    transactionStarted = false;

    console.log('\n==============================================');
    console.log(' MIGRATION SUCCESSFUL');
    console.log('==============================================');
    console.log('All rows migrated successfully.');
    console.log('All row counts match.');
    console.log('All foreign-key relationships are valid.');
    console.log('SQLite source was not modified.');

  } catch (error) {
    console.error('\n==============================================');
    console.error(' MIGRATION FAILED');
    console.error('==============================================');

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    // ------------------------------------------------------------
    // Roll back only if BEGIN succeeded.
    // ------------------------------------------------------------

    if (pgClient && transactionStarted) {
      try {
        console.error('\nRolling back PostgreSQL transaction...');
        await pgClient.query('ROLLBACK');
        console.error('Rollback completed.');
      } catch (rollbackError) {
        console.error(
          'Rollback itself failed:',
          rollbackError
        );
      }
    }

    // Important: make the process fail.
    process.exitCode = 1;

  } finally {
    // ------------------------------------------------------------
    // Close resources
    // ------------------------------------------------------------

    if (sqliteDb) {
      sqliteDb.close();
      console.log('\nSQLite connection closed.');
    }

    if (pgClient) {
      await pgClient.end();
      console.log('PostgreSQL connection closed.');
    }
  }
}

void migrate();