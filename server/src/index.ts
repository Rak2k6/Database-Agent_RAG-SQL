import 'dotenv/config';
import { createApp } from './server.js';
import { verifySqlConnection } from './db/pool.js';

verifySqlConnection()
  .then((info) => {
    console.info(
      `✅ SQL Server connection verified (${info.server}/${info.databaseName}).`,
    );

    const app = createApp();
    const port = Number(process.env.PORT ?? 3000);

    app.listen(port, () => {
      console.info(
        `Northstar API listening on http://localhost:${port} (SQL Server)`,
      );
    });
  })
  .catch((err: unknown) => {
    console.error('❌ Failed to connect to SQL Server:', err);
    process.exitCode = 1;
  });