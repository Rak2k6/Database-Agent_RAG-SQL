import pg from 'pg';
import { config } from 'dotenv';
// eslint-disable-next-line @typescript-eslint/no-var-requires

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import sql from 'mssql/msnodesqlv8.js';
import { createRequire } from 'node:module';
config();

// ── Driver pin ──────────────────────────────────────────────────────────────
// mssql v12 keeps ONE shared driver singleton (lib/shared.js `driver`) that
// BOTH entry points mutate on import:
//   mssql/msnodesqlv8.js → shared.driver = { msnodesqlv8 Request/Transaction }
//   mssql (Tedious)      → shared.driver = { tedious Request/Transaction }
// Whichever module is imported LAST wins, and pool.request() builds
// `new shared.driver.Request(...)`. A domain module importing bare 'mssql'
// (even just for type constants like sql.NVarChar) flips the singleton back
// to Tedious, so an msnodesqlv8 connection object lands in a Tedious Request
// → `TypeError: connection.on is not a function` (tedious/request.js:494).
// `ensureMsv8Driver()` re-requires the msnodesqlv8 entry point at pool-build
// time (after all module imports have run), re-asserting the correct variant
// regardless of import order elsewhere. Only pool.ts is touched.
const cjsRequire = createRequire(
  // @ts-expect-error - api:check compiles as CJS; runtime is ESM via tsx where import.meta exists
  import.meta.url,
);

function ensureMsv8Driver(): typeof sql {
  // require() is cached, so re-requiring the entry point does NOT re-run its
  // `shared.driver.X = ...` assignments. Re-assert the fields directly.
  const msv8 = cjsRequire('mssql/lib/msnodesqlv8') as typeof sql;
  const shared = cjsRequire('mssql/lib/shared') as {
    driver: Record<string, unknown>;
  };
  shared.driver['name'] = 'msnodesqlv8';
  shared.driver['ConnectionPool'] = msv8.ConnectionPool;
  shared.driver['Transaction'] = msv8.Transaction;
  shared.driver['Request'] = msv8.Request;
  return msv8;
}

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.PG_URI,
});

// ── SQL Server 2025 connection layer (Phase 2) ──────────────────────────────
// mssql + msnodesqlv8 + ODBC Driver 18 + Named Pipes + Windows Trusted Connection.
// TCP/IP is disabled on this instance, so Tedious/TCP must NOT be used.
// The pg `pool` above is intentionally left in place for rollback until the
// domain modules are migrated in later phases.

function buildConnectionString(): string {
  const driver = process.env.DB_DRIVER ?? 'ODBC Driver 18 for SQL Server';
  const pipe =
    process.env.DB_PIPE ??
    String.raw`np:\\.\pipe\sql\query`;
  const database = process.env.DB_NAME ?? 'Northstar';
  return (
    `Driver={${driver}};Server=${pipe};Database=${database};` +
    'Trusted_Connection=yes;TrustServerCertificate=yes;'
  );
}

const sqlConfig = {
  connectionString: buildConnectionString(),
  driver: 'msnodesqlv8' as const,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

type SqlPool = InstanceType<typeof sql.ConnectionPool>;

let poolPromise: Promise<SqlPool> | undefined;

/** Shared SQL Server connection pool promise. Connects once, reuses connections. */
export function getPool(): Promise<SqlPool> {
  if (poolPromise === undefined) {
    const driver = ensureMsv8Driver();
    const connecting: Promise<SqlPool> =
  new driver.ConnectionPool(sqlConfig as any).connect();
    poolPromise = connecting;
  }
  return poolPromise;
}

/** Read-only startup/health check. Does not modify any data. */
export async function verifySqlConnection(): Promise<{
  ok: number;
  databaseName: string;
  server: string;
}> {
  const p = await getPool();
  const request = p.request();
  const result = await request.query(
    'SELECT 1 AS ok, DB_NAME() AS database_name, @@SERVERNAME AS server_name',
  );
  const row = result.recordset[0] as {
    ok: number;
    database_name: string;
    server_name: string;
  };
  return { ok: row.ok, databaseName: row.database_name, server: row.server_name };
}

/** Graceful shutdown of the SQL Server pool (used by tests / process exit). */
export async function closeSqlPool(): Promise<void> {
  if (poolPromise) {
    const p = await poolPromise.catch(() => undefined);
    poolPromise = undefined;
    if (p) await p.close();
  }
}

