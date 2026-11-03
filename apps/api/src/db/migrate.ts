import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { loadConfig } from "../config.js";
import { closePool, execute, initPool, queryRows } from "./pool.js";
import { sqlNow } from "./time.js";

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../db/migrations");

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function migrate(databaseUrl: string): Promise<string[]> {
  const db = initPool(databaseUrl);
  await execute(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB`,
  );
  const applied = new Set(
    (await queryRows<RowDataPacket>(db, "SELECT id FROM schema_migrations")).map((row) => String(row.id)),
  );
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    for (const statement of statements(sql)) {
      await execute(db, statement);
    }
    await execute(db, "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [file, sqlNow()]);
    ran.push(file);
  }
  return ran;
}

if (process.argv[1]?.includes("migrate.ts")) {
  const databaseUrl = loadConfig().databaseUrl;
  if (!databaseUrl) {
    console.error("DATABASE_URL ausente. Copie .env.example para .env.");
    process.exitCode = 1;
  } else {
    migrate(databaseUrl)
      .then(async (ran) => {
        console.log(ran.length === 0 ? "Migrações já aplicadas." : `Aplicadas: ${ran.join(", ")}`);
        await closePool();
      })
      .catch(async (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        await closePool();
        process.exitCode = 1;
      });
  }
}
