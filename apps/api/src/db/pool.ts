import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { HttpError } from "../http-error.js";

export type Db = Pool | PoolConnection;

let pool: Pool | undefined;

export function initPool(databaseUrl: string): Pool {
  if (pool) return pool;
  pool = createPool({
    uri: databaseUrl,
    connectionLimit: 5,
    timezone: "Z",
    connectTimeout: 3000,
    multipleStatements: false,
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new HttpError(503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
  }
  return pool;
}

export function hasPool(): boolean {
  return pool !== undefined;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

export async function pingDatabase(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

type SqlValue = string | number | boolean | Date | Buffer | null;

export async function queryRows<T extends RowDataPacket>(
  db: Db,
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  const [rows] = await db.execute<T[]>(sql, params);
  return rows;
}

export async function execute(db: Db, sql: string, params: SqlValue[] = []): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
