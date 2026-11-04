import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, clearLoginLimits } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { closePool, execute, getPool, initPool, queryRows } from "../src/db/pool.js";
import { demoPassword, seed } from "../src/db/seed.js";
import { drainRequest } from "../src/modules/outbox/worker.js";
import type { RowDataPacket } from "mysql2/promise";

const config = loadConfig();
const databaseUrl = config.databaseUrl;

async function databaseIsReachable(): Promise<boolean> {
  if (!databaseUrl) return false;
  try {
    initPool(databaseUrl);
    const ok = await Promise.race([
      import("../src/db/pool.js").then((mod) => mod.pingDatabase()),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
    ]);
    if (!ok) await closePool();
    return ok;
  } catch {
    await closePool();
    return false;
  }
}

const databaseReady = await databaseIsReachable();

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: demoPassword },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(raw).toBeTruthy();
  return { cookie: String(raw).split(";")[0], body: response.json() };
}

describe.skipIf(!databaseReady)("API com MySQL", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    initPool(databaseUrl!);
    await migrate(databaseUrl!);
    await seed(databaseUrl!);
    app = buildApp({ ...config, databaseUrl });
    await app.ready();
  });

  afterEach(async () => {
    clearLoginLimits();
    const ids = await queryRows<RowDataPacket>(
      getPool(),
      "SELECT id FROM access_requests WHERE justification LIKE 'teste:%'",
    );
    const requestIds = ids.map((row) => String(row.id));
    if (requestIds.length === 0) return;
    const marks = requestIds.map(() => "?").join(", ");
    const grants = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT id FROM access_grants WHERE request_id IN (${marks})`,
      requestIds,
    );
    const grantIds = grants.map((row) => String(row.id));
    if (grantIds.length > 0) {
      const grantMarks = grantIds.map(() => "?").join(", ");
      await execute(getPool(), `DELETE FROM directory_memberships WHERE grant_id IN (${grantMarks})`, grantIds);
      await execute(getPool(), `DELETE FROM outbox_events WHERE aggregate_id IN (${grantMarks})`, grantIds);
      await execute(getPool(), `DELETE FROM audit_events WHERE entity_id IN (${grantMarks})`, grantIds);
      await execute(getPool(), `DELETE FROM access_grants WHERE id IN (${grantMarks})`, grantIds);
    }
    await execute(getPool(), `DELETE FROM risk_alerts WHERE request_id IN (${marks})`, requestIds);
    await execute(getPool(), `DELETE FROM risk_assessments WHERE request_id IN (${marks})`, requestIds);
    await execute(getPool(), `DELETE FROM outbox_events WHERE aggregate_id IN (${marks})`, requestIds);
    await execute(getPool(), `DELETE FROM audit_events WHERE entity_id IN (${marks})`, requestIds);
    await execute(getPool(), `DELETE FROM access_requests WHERE id IN (${marks})`, requestIds);
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("recusa senha errada sem revelar se o e-mail existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ana.costa@helios.example", password: "errada" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("E-mail ou senha inválidos.");
    expect(JSON.stringify(response.json())).not.toContain("scrypt");
  });

  it("impede colaborador de listar usuários e ignora papel enviado no corpo", async () => {
    const ana = await login(app, "ana.costa@helios.example");
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { cookie: ana.cookie },
    });
    expect(listed.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload: {
        profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        justification: "teste: consulta fiscal",
        role: "admin",
        status: "approved",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("pending_approval");
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: ana.cookie },
    });
    expect(me.json().user.role).toBe("employee");
  });

  it("recusa solicitação aberta duplicada", async () => {
    const ana = await login(app, "ana.costa@helios.example");
    const payload = {
      profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      justification: "teste: lançamento",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
  });

  it("impede autoaprovação e colaborador sem permissão", async () => {
    const ana = await login(app, "ana.costa@helios.example");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload: {
        profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        justification: "teste: folha",
      },
    });
    const id = created.json().id as string;
    const self = await app.inject({
      method: "POST",
      url: `/api/v1/access-requests/${id}/approve`,
      headers: { cookie: ana.cookie },
    });
    expect(self.statusCode).toBe(403);

    const diego = await login(app, "diego.alves@helios.example");
    const analyst = await app.inject({
      method: "POST",
      url: `/api/v1/access-requests/${id}/approve`,
      headers: { cookie: diego.cookie },
    });
    expect(analyst.statusCode).toBe(403);
  });

  it("exige justificativa na recusa e permite aprovação do gestor", async () => {
    const ana = await login(app, "ana.costa@helios.example");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload: {
        profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
        justification: "teste: pagamento",
      },
    });
    const id = created.json().id as string;
    const bruno = await login(app, "bruno.lima@helios.example");
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/access-requests/${id}/reject`,
      headers: { cookie: bruno.cookie },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/access-requests/${id}/approve`,
      headers: { cookie: bruno.cookie },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");
  });

  it("trata busca com aspas como texto, sem erro de SQL", async () => {
    const clara = await login(app, "clara.nunes@helios.example");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users?q=" + encodeURIComponent("' OR 1=1 --"),
      headers: { cookie: clara.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
    expect(response.json().error).toBeUndefined();
  });

  async function approvedRequest(profileId: string, justification: string) {
    const ana = await login(app, "ana.costa@helios.example");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/access-requests",
      headers: { cookie: ana.cookie },
      payload: { profileId, justification },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const bruno = await login(app, "bruno.lima@helios.example");
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/access-requests/${id}/approve`,
      headers: { cookie: bruno.cookie },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");
    return id;
  }

  it("provisiona uma vez e ignora a mesma mensagem de novo", async () => {
    const id = await approvedRequest("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "teste: provisionar consulta");
    await drainRequest(id);
    const grants = async () => {
      const rows = await queryRows<RowDataPacket>(
        getPool(),
        "SELECT COUNT(*) AS total FROM access_grants WHERE request_id = ?",
        [id],
      );
      return Number(rows[0]?.total ?? 0);
    };
    const stored = await queryRows<RowDataPacket>(getPool(), "SELECT status FROM access_requests WHERE id = ?", [id]);
    expect(stored[0]?.status).toBe("provisioned");
    expect(await grants()).toBe(1);

    await execute(
      getPool(),
      `UPDATE outbox_events
       SET status = 'pending', processed_at = NULL, attempts = 0, available_at = UTC_TIMESTAMP(3)
       WHERE aggregate_id = ? AND event_type = 'provisioning.completed'`,
      [id],
    );
    await drainRequest(id);
    expect(await grants()).toBe(1);
    const requested = await queryRows<RowDataPacket>(
      getPool(),
      "SELECT COUNT(*) AS total FROM outbox_events WHERE aggregate_id = ? AND event_type = 'provisioning.requested'",
      [id],
    );
    expect(Number(requested[0]?.total ?? 0)).toBe(1);
  });

  it("não cria concessão quando o diretório fictício recusa", async () => {
    const id = await approvedRequest("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", "teste: recusa-simulada");
    await drainRequest(id);
    const stored = await queryRows<RowDataPacket>(getPool(), "SELECT status FROM access_requests WHERE id = ?", [id]);
    expect(stored[0]?.status).toBe("failed");
    const grants = await queryRows<RowDataPacket>(
      getPool(),
      "SELECT COUNT(*) AS total FROM access_grants WHERE request_id = ?",
      [id],
    );
    expect(Number(grants[0]?.total ?? 0)).toBe(0);
    await drainRequest(id);
    const again = await queryRows<RowDataPacket>(
      getPool(),
      "SELECT COUNT(*) AS total FROM access_grants WHERE request_id = ?",
      [id],
    );
    expect(Number(again[0]?.total ?? 0)).toBe(0);
  });
});
