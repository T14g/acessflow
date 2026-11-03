import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { closePool, execute, initPool, withTransaction } from "./pool.js";
import { hashPassword } from "../password.js";
import { sqlNow } from "./time.js";

export const demoPassword = "Helios-demo-1";

const ids = {
  bruno: "22222222-2222-4222-8222-222222222222",
  ana: "11111111-1111-4111-8111-111111111111",
  clara: "33333333-3333-4333-8333-333333333333",
  diego: "44444444-4444-4444-8444-444444444444",
  erp: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  payroll: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  erpRead: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  erpPost: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  payrollRead: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  payrollPay: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
  sod: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
};

export async function seed(databaseUrl: string): Promise<void> {
  initPool(databaseUrl);
  const now = sqlNow();
  const passwordHash = await hashPassword(demoPassword);
  await withTransaction(async (db) => {
    const people = [
      [ids.bruno, "Bruno Lima", "bruno.lima@helios.example", "manager", null],
      [ids.ana, "Ana Costa", "ana.costa@helios.example", "employee", ids.bruno],
      [ids.clara, "Clara Nunes", "clara.nunes@helios.example", "admin", ids.bruno],
      [ids.diego, "Diego Alves", "diego.alves@helios.example", "security_analyst", null],
    ] as const;
    for (const [id, name, email, role, managerId] of people) {
      await execute(
        db,
        `INSERT INTO users (id, display_name, email, password_hash, role, manager_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash),
           role = VALUES(role), manager_id = VALUES(manager_id), status = 'active'`,
        [id, name, email, passwordHash, role, managerId, now],
      );
    }
    await execute(
      db,
      `INSERT INTO systems (id, code, name, description) VALUES
        (?, 'erp-fiscal', 'ERP Fiscal', 'Sistema fictício de lançamentos fiscais da Helios.'),
        (?, 'folha', 'Folha Helios', 'Sistema fictício de pagamento da folha.')
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      [ids.erp, ids.payroll],
    );
    await execute(
      db,
      `INSERT INTO profiles (id, system_id, code, name, privileged) VALUES
        (?, ?, 'consulta', 'Consulta fiscal', 0),
        (?, ?, 'lancamento', 'Lançamento fiscal', 1),
        (?, ?, 'consulta', 'Consulta da folha', 0),
        (?, ?, 'pagamento', 'Pagamento da folha', 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), privileged = VALUES(privileged)`,
      [ids.erpRead, ids.erp, ids.erpPost, ids.erp, ids.payrollRead, ids.payroll, ids.payrollPay, ids.payroll],
    );
    await execute(
      db,
      `INSERT INTO sod_conflicts (id, profile_a_id, profile_b_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_a_id = VALUES(profile_a_id)`,
      [ids.sod, ids.erpPost, ids.payrollPay],
    );
  });
}

if (process.argv[1]?.includes("seed.ts")) {
  const databaseUrl = loadConfig().databaseUrl;
  if (!databaseUrl) {
    console.error("DATABASE_URL ausente. Copie .env.example para .env.");
    process.exitCode = 1;
  } else {
    seed(databaseUrl)
      .then(async () => {
        console.log("Seed fictício aplicado.");
        await closePool();
      })
      .catch(async (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        await closePool();
        process.exitCode = 1;
      });
  }
}
