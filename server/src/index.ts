import 'dotenv/config';
import { createApp } from './server.js';
import { seedDatabase } from './seed.js';
import { databasePath } from './db.js';

seedDatabase().then(() => {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);

  app.listen(port, () => {
    console.info(`Northstar auth API listening on http://localhost:${port}; SQLite: ${databasePath}`);
  });
}).catch((err) => {
  console.error('Failed to seed database:', err);
  process.exitCode = 1;
});

