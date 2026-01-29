/**
 * One-off script: drop all bridge tables/views and re-run schema.
 * Use for a fresh mainnet deployment (empties DB).
 * Run: npm run db:reset (from backend/) or: node scripts/reset-db.js
 * Requires DATABASE_URL in .env.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const dropOrder = `
DROP TRIGGER IF EXISTS update_lock_events_updated_at ON lock_events;
DROP VIEW IF EXISTS pending_locks CASCADE;
DROP VIEW IF EXISTS bridge_stats CASCADE;
DROP TABLE IF EXISTS unlock_events CASCADE;
DROP TABLE IF EXISTS merkle_proofs CASCADE;
DROP TABLE IF EXISTS lock_events CASCADE;
DROP TABLE IF EXISTS block_roots CASCADE;
DROP TABLE IF EXISTS relayer_transactions CASCADE;
DROP TABLE IF EXISTS bridge_history CASCADE;
DROP TABLE IF EXISTS system_metrics CASCADE;
DROP TABLE IF EXISTS failed_transactions CASCADE;
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    console.log('Dropping existing tables/views...');
    await client.query(dropOrder);
    console.log('Running schema...');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', 'src', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('DB reset complete.');
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
