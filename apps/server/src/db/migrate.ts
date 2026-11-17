import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const migrationsFolder = path.resolve(__dirname, 'migrations');
  console.log(`Running database migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log('Database migrations completed successfully.');
}

if (process.argv[1] === __filename) {
  runMigrations()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('Migration failed:', error);
      await closeDb();
      process.exit(1);
    });
}
