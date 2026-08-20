import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);
}

export async function migrate() {
  const pool = db();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(row => row.version));
  const files = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();

  for (const filename of files) {
    const version = filename.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of splitSql(sql)) await connection.query(statement);
      await connection.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      await connection.commit();
      console.log(`✓ migration ${version}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
