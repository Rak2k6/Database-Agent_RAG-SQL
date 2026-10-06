import { getPool } from '../db/pool.js';
import { validateReadOnlySql } from './sqlGuard.js';

export async function executeReadOnlySql(
  query: string,
): Promise<unknown[]> {
  const start = Date.now();

  validateReadOnlySql(query);

  const pool = await getPool();
  const transaction = pool.transaction();

  let transactionStarted = false;

  try {
    await transaction.begin();
    transactionStarted = true;

    const result = await transaction
      .request()
      .query(query);

    await transaction.commit();
    transactionStarted = false;

    console.log(
      `[DB] SQL Server execution: ${Date.now() - start} ms`,
    );

    return result.recordset;
  } catch (error) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'AI query failed and its SQL Server transaction could not be rolled back.',
        );
      }
    }

    throw error;
  }
}