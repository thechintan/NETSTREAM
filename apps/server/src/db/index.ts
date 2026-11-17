import postgres from 'postgres';
import { config } from '../config/index.js';

export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5,
  onnotice: () => {}, // silence notice spam
});

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
    // Ignore close errors during shutdown
  }
}
