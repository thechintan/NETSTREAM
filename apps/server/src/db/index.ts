import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import * as schema from './schema.js';

export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });
export type Database = typeof db;
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(
  callback: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(callback);
}

export async function pingDb(): Promise<boolean> {
  try {
    const result = await sql`SELECT 1 as healthy`;
    return result.length > 0;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // Ignore close errors
  }
}

export * from './schema.js';
