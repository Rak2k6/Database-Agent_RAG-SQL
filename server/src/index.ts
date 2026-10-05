import 'dotenv/config';
import { createApp } from './server.js';
import { pool } from './db/pool.js';

pool.connect()
  .then((client) => {
    client.release();
    console.info('✅  PostgreSQL connection verified.');

    const app = createApp();
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, () => {
      console.info(`Northstar API listening on http://localhost:${port} (PostgreSQL)`);
    });
  })
  .catch((err: unknown) => {
    console.error('❌  Failed to connect to PostgreSQL:', err);
    process.exitCode = 1;
  });
