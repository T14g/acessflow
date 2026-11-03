import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import {
  createRequestSchema,
  loginSchema,
  rejectSchema,
  requestStatuses,
  revokeSchema,
  roles,
} from "@accessflow/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import type { AppConfig } from "./config.js";
import { fromZod, HttpError } from "./http-error.js";
import { hasPool, pingDatabase } from "./db/pool.js";
import {
  approveRequest,
  createRequest,
  getRequest,
  listRequests,
  rejectRequest,
  revokeGrant,
} from "./modules/access-requests/service.js";
import {
  canReadUser,
  getUser,
  listUsers,
  login,
  revokeSession,
  toPublic,
  userFromSession,
  type CurrentUser,
} from "./modules/identity/service.js";
import { queryRows } from "./db/pool.js";
import type { RowDataPacket } from "mysql2/promise";

const sessionCookie = "accessflow_session";
const loginHits = new Map<string, number[]>();

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZod(result.error);
  return result.data;
}

function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw new HttpError(401, "UNAUTHENTICATED", "Sessão ausente ou expirada.");
  return request.currentUser;
}

function pageQuery(query: FastifyRequest["query"]) {
  const source = (query ?? {}) as Record<string, unknown>;
  const page = Number(source.page ?? 1);
  const pageSize = Number(source.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new HttpError(400, "VALIDATION_ERROR", "Paginação inválida.");
  }
  return { page, pageSize, source };
}

function tooManyLogins(key: string): boolean {
  const now = Date.now();
  const recent = (loginHits.get(key) ?? []).filter((stamp) => now - stamp < 60_000);
  recent.push(now);
  loginHits.set(key, recent);
  return recent.length > 10;
}

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.body.password", "req.headers.cookie", "req.headers.authorization"],
    },
  });
  app.decorateRequest("currentUser", null);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send({
      error: { code: "INTERNAL", message: "Erro interno.", details: [] },
    });
  });

  app.register(helmet);
  app.register(cors, { origin: config.webOrigin, credentials: true });
  app.register(cookie);

  app.addHook("onRequest", async (request) => {
    request.currentUser = null;
    if (!hasPool()) return;
    const sessionId = request.cookies[sessionCookie];
    if (!sessionId) return;
    request.currentUser = await userFromSession(sessionId);
  });

  app.get("/health", async () => ({
    status: "ok",
    database: hasPool() && (await pingDatabase()) ? "up" : "down",
  }));

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const key = `${request.ip}:${body.email.toLowerCase()}`;
    if (tooManyLogins(key)) {
      throw new HttpError(429, "RATE_LIMITED", "Muitas tentativas de login. Espere um minuto.");
    }
    const result = await login(body.email, body.password);
    reply.setCookie(sessionCookie, result.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    return { user: toPublic(result.user) };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireUser(request);
    const sessionId = request.cookies[sessionCookie];
    if (sessionId) await revokeSession(sessionId);
    reply.clearCookie(sessionCookie, { path: "/" });
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request) => ({ user: toPublic(requireUser(request)) }));

  app.get("/api/v1/users", async (request) => {
    const actor = requireUser(request);
    if (actor.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Apenas administrador lista usuários.");
    const { page, pageSize, source } = pageQuery(request.query);
    const role = typeof source.role === "string" ? source.role : undefined;
    if (role && !roles.includes(role as (typeof roles)[number])) {
      throw new HttpError(400, "VALIDATION_ERROR", "Papel inválido.");
    }
    const q = typeof source.q === "string" ? source.q.slice(0, 180) : undefined;
    return listUsers({ role, q, page, pageSize });
  });

  app.get("/api/v1/users/:id", async (request) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };
    const target = await getUser(id);
    if (!target || !canReadUser(actor, target)) throw new HttpError(404, "NOT_FOUND", "Usuário não encontrado.");
    return { user: toPublic(target) };
  });

  app.get("/api/v1/systems", async (request) => {
    requireUser(request);
    const { page, pageSize } = pageQuery(request.query);
    const pool = (await import("./db/pool.js")).getPool();
    const totalRow = await queryRows<RowDataPacket>(pool, "SELECT COUNT(*) AS total FROM systems");
    const offset = (page - 1) * pageSize;
    const data = await queryRows<RowDataPacket>(
      pool,
      `SELECT id, code, name, description FROM systems ORDER BY name LIMIT ${pageSize} OFFSET ${offset}`,
    );
    return { data, page, pageSize, total: Number(totalRow[0]?.total ?? 0) };
  });

  app.get("/api/v1/systems/:systemId/profiles", async (request) => {
    requireUser(request);
    const { systemId } = request.params as { systemId: string };
    const pool = (await import("./db/pool.js")).getPool();
    const systems = await queryRows<RowDataPacket>(pool, "SELECT id FROM systems WHERE id = ? LIMIT 1", [systemId]);
    if (systems.length === 0) throw new HttpError(404, "NOT_FOUND", "Sistema não encontrado.");
    const data = await queryRows<RowDataPacket>(
      pool,
      "SELECT id, code, name, privileged FROM profiles WHERE system_id = ? ORDER BY name",
      [systemId],
    );
    return {
      data: data.map((row) => ({ ...row, privileged: Boolean(row.privileged) })),
    };
  });

  app.post("/api/v1/access-requests", async (request, reply) => {
    const actor = requireUser(request);
    const body = parse(createRequestSchema, request.body);
    const created = await createRequest(actor, body);
    return reply.status(201).send(created);
  });

  app.get("/api/v1/access-requests", async (request) => {
    const actor = requireUser(request);
    const { page, pageSize, source } = pageQuery(request.query);
    const status = typeof source.status === "string" ? source.status : undefined;
    if (status && !requestStatuses.includes(status as (typeof requestStatuses)[number])) {
      throw new HttpError(400, "VALIDATION_ERROR", "Estado inválido.");
    }
    const beneficiaryId = typeof source.beneficiaryId === "string" ? source.beneficiaryId : undefined;
    return listRequests(actor, { status, beneficiaryId, page, pageSize });
  });

  app.get("/api/v1/access-requests/:id", async (request) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };
    return getRequest(actor, id);
  });

  app.post("/api/v1/access-requests/:id/approve", async (request) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };
    return approveRequest(actor, id);
  });

  app.post("/api/v1/access-requests/:id/reject", async (request) => {
    const actor = requireUser(request);
    const body = parse(rejectSchema, request.body);
    const { id } = request.params as { id: string };
    return rejectRequest(actor, id, body.justification);
  });

  app.get("/api/v1/audit-events", async (request) => {
    const actor = requireUser(request);
    if (actor.role !== "admin" && actor.role !== "security_analyst") {
      throw new HttpError(403, "FORBIDDEN", "Auditoria restrita ao analista e ao administrador.");
    }
    const { page, pageSize, source } = pageQuery(request.query);
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (typeof source.entityType === "string") {
      where.push("entity_type = ?");
      params.push(source.entityType.slice(0, 40));
    }
    if (typeof source.entityId === "string") {
      where.push("entity_id = ?");
      params.push(source.entityId.slice(0, 36));
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const pool = (await import("./db/pool.js")).getPool();
    const totalRow = await queryRows<RowDataPacket>(pool, `SELECT COUNT(*) AS total FROM audit_events ${clause}`, params);
    const offset = (page - 1) * pageSize;
    const data = await queryRows<RowDataPacket>(
      pool,
      `SELECT id, actor_id, action, entity_type, entity_id, payload, created_at
       FROM audit_events ${clause}
       ORDER BY created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data, page, pageSize, total: Number(totalRow[0]?.total ?? 0) };
  });

  app.get("/api/v1/access-grants", async (request) => {
    const actor = requireUser(request);
    const { page, pageSize, source } = pageQuery(request.query);
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (actor.role === "employee") {
      where.push("g.user_id = ?");
      params.push(actor.id);
    } else if (actor.role === "manager") {
      where.push("(g.user_id = ? OR u.manager_id = ?)");
      params.push(actor.id, actor.id);
    }
    if (typeof source.userId === "string") {
      where.push("g.user_id = ?");
      params.push(source.userId);
    }
    if (typeof source.status === "string") {
      where.push("g.status = ?");
      params.push(source.status);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const pool = (await import("./db/pool.js")).getPool();
    const totalRow = await queryRows<RowDataPacket>(
      pool,
      `SELECT COUNT(*) AS total FROM access_grants g JOIN users u ON u.id = g.user_id ${clause}`,
      params,
    );
    const offset = (page - 1) * pageSize;
    const data = await queryRows<RowDataPacket>(
      pool,
      `SELECT g.id, g.user_id, g.profile_id, g.status, g.granted_at, g.expires_at
       FROM access_grants g JOIN users u ON u.id = g.user_id
       ${clause}
       ORDER BY g.granted_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data, page, pageSize, total: Number(totalRow[0]?.total ?? 0) };
  });

  app.get("/api/v1/risk-alerts", async (request) => {
    const actor = requireUser(request);
    if (actor.role !== "admin" && actor.role !== "security_analyst") {
      throw new HttpError(403, "FORBIDDEN", "Alertas restritos ao analista e ao administrador.");
    }
    const { page, pageSize, source } = pageQuery(request.query);
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (typeof source.severity === "string") {
      where.push("severity = ?");
      params.push(source.severity);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const pool = (await import("./db/pool.js")).getPool();
    const totalRow = await queryRows<RowDataPacket>(pool, `SELECT COUNT(*) AS total FROM risk_alerts ${clause}`, params);
    const offset = (page - 1) * pageSize;
    const data = await queryRows<RowDataPacket>(
      pool,
      `SELECT id, request_id, severity, code, message, created_at
       FROM risk_alerts ${clause}
       ORDER BY created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data, page, pageSize, total: Number(totalRow[0]?.total ?? 0) };
  });

  app.post("/api/v1/access-grants/:id/revoke", async (request) => {
    const actor = requireUser(request);
    const body = parse(revokeSchema, request.body);
    const { id } = request.params as { id: string };
    return revokeGrant(actor, id, body.justification);
  });

  return app;
}

export function clearLoginLimits(): void {
  loginHits.clear();
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
  interface FastifyReply {
    setCookie: FastifyReply["setCookie"];
  }
}
