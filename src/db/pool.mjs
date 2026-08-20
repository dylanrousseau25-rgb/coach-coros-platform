import mysql from 'mysql2/promise';
import { config } from '../config.mjs';

let pool;

export function db() {
  if (!pool) {
    const cfg = config();
    pool = mysql.createPool({
      ...cfg.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: 'Z',
      charset: 'utf8mb4',
      supportBigNumbers: true
    });
  }
  return pool;
}

export async function withTransaction(fn) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const value = await fn(connection);
    await connection.commit();
    return value;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
