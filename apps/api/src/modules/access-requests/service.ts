import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { HttpError } from "../../http-error.js";
import { execute, getPool, queryRows, withTransaction } from "../../db/pool.js";
import { iso, sqlNow } from "../../db/time.js";
import { assessRisk, type FindingCode } from "../access-guard/rules.js";
import { canTransition } from "./transitions.js";
import type { CurrentUser } from "../identity/service.js";

type RequestRow = RowDataPacket & {
  id: string;
  requester_id: string;
  beneficiary_id: string;
  profile_id: string;
  justification: string;
  expires_at: Date | null;
  status: string;
  decision_by: string | null;
  decision_justification: string | null;
  created_at: Date;
  updated_at: Date;
  profile_name: string;
  system_name: string;
  beneficiary_name: string;
  requester_name: string;
  beneficiary_manager_id: string | null;
  privileged: number;
};

const selectRequest = `
  SELECT r.id, r.requester_id, r.beneficiary_id, r.profile_id, r.justification, r.expires_at, r.status,
         r.decision_by, r.decision_justification, r.created_at, r.updated_at,
         p.name AS profile_name, p.privileged, s.name AS system_name,
         bu.display_name AS beneficiary_name, bu.manager_id AS beneficiary_manager_id,
         ru.display_name AS requester_name
  FROM access_requests r
  JOIN profiles p ON p.id = r.profile_id
  JOIN systems s ON s.id = p.system_id
  JOIN users bu ON bu.id = r.beneficiary_id
  JOIN users ru ON ru.id = r.requester_id
`;

function scope(actor: CurrentUser): { sql: string; params: string[] } {
  if (actor.role === "admin" || actor.role === "security_analyst") return { sql: "1 = 1", params: [] };
  if (actor.role === "manager") {
    return {
      sql: "(r.requester_id = ? OR r.beneficiary_id = ? OR bu.manager_id = ?)",
      params: [actor.id, actor.id, actor.id],
    };
  }
  return { sql: "(r.requester_id = ? OR r.beneficiary_id = ?)", params: [actor.id, actor.id] };
}

function mapRequest(row: RequestRow, assessment: unknown = null, alerts: unknown[] = []) {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: row.beneficiary_name,
    profileId: row.profile_id,
    profileName: row.profile_name,
    systemName: row.system_name,
    privileged: Boolean(row.privileged),
    justification: row.justification,
    expiresAt: iso(row.expires_at),
    status: row.status,
    decisionBy: row.decision_by,
    decisionJustification: row.decision_justification,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    assessment,
    alerts,
  };
}

async function recordSideEffects(
  db: Parameters<typeof execute>[0],
  actorId: string | null,
  requestId: string,
  action: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const now = sqlNow();
  await execute(
    db,
    `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, payload, created_at)
     VALUES (?, ?, ?, 'access_request', ?, ?, ?)`,
    [randomUUID(), actorId, action, requestId, JSON.stringify(payload), now],
  );
  await execute(
    db,
    `INSERT INTO outbox_events
      (id, aggregate_type, aggregate_id, event_type, payload, status, attempts, available_at, created_at)
     VALUES (?, 'access_request', ?, ?, ?, 'pending', 0, ?, ?)`,
    [randomUUID(), requestId, eventType, JSON.stringify(payload), now, now],
  );
}

export async function createRequest(
  actor: CurrentUser,
  input: { profileId: string; justification: string; expiresAt?: string; beneficiaryId?: string },
) {
  if (actor.role === "security_analyst") {
    throw new HttpError(403, "FORBIDDEN", "Analista não solicita acesso.");
  }
  const beneficiaryId = actor.role === "admin" && input.beneficiaryId ? input.beneficiaryId : actor.id;
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(400, "VALIDATION_ERROR", "O prazo precisa estar no futuro.", [
      { path: "expiresAt", message: "Informe uma data futura." },
    ]);
  }

  return withTransaction(async (db) => {
    const profiles = await queryRows<RowDataPacket>(
      db,
      "SELECT id, privileged, name FROM profiles WHERE id = ? LIMIT 1",
      [input.profileId],
    );
    const profile = profiles[0];
    if (!profile) throw new HttpError(404, "NOT_FOUND", "Perfil não encontrado.");
    const beneficiaries = await queryRows<RowDataPacket>(
      db,
      "SELECT id, status FROM users WHERE id = ? LIMIT 1",
      [beneficiaryId],
    );
    if (!beneficiaries[0] || beneficiaries[0].status !== "active") {
      throw new HttpError(404, "NOT_FOUND", "Beneficiário não encontrado.");
    }

    const open = await queryRows<RowDataPacket>(
      db,
      `SELECT id FROM access_requests
       WHERE beneficiary_id = ? AND profile_id = ?
         AND status IN ('submitted', 'pending_approval', 'approved', 'provisioning')
       LIMIT 1 FOR UPDATE`,
      [beneficiaryId, input.profileId],
    );
    if (open.length > 0) {
      throw new HttpError(409, "CONFLICT", "Já existe uma solicitação aberta para este perfil.");
    }

    const activeGrant = await queryRows<RowDataPacket>(
      db,
      "SELECT id FROM access_grants WHERE user_id = ? AND profile_id = ? AND status = 'active' LIMIT 1",
      [beneficiaryId, input.profileId],
    );
    if (activeGrant.length > 0) {
      throw new HttpError(409, "CONFLICT", "O beneficiário já possui este perfil ativo.");
    }
    const conflicts = await queryRows<RowDataPacket>(
      db,
      `SELECT g.id
       FROM sod_conflicts c
       JOIN access_grants g
         ON g.profile_id = IF(c.profile_a_id = ?, c.profile_b_id, c.profile_a_id)
        AND g.user_id = ? AND g.status = 'active'
       WHERE c.profile_a_id = ? OR c.profile_b_id = ?
       LIMIT 1`,
      [input.profileId, beneficiaryId, input.profileId, input.profileId],
    );

    const requestId = randomUUID();
    const now = sqlNow();
    await execute(
      db,
      `INSERT INTO access_requests
        (id, requester_id, beneficiary_id, profile_id, justification, expires_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
      [
        requestId,
        actor.id,
        beneficiaryId,
        input.profileId,
        input.justification,
        input.expiresAt ? sqlNow(new Date(input.expiresAt)) : null,
        now,
        now,
      ],
    );
    await recordSideEffects(db, actor.id, requestId, "access_request.submitted", "access_request.submitted", {
      requestId,
      profileId: input.profileId,
      beneficiaryId,
    });

    const flags: Record<FindingCode, boolean> = {
      sod_conflict: conflicts.length > 0,
      privileged_profile: Boolean(profile.privileged),
      access_already_active: activeGrant.length > 0,
      beneficiary_differs: actor.id !== beneficiaryId,
    };
    const assessment = assessRisk(flags);
    const assessmentId = randomUUID();
    await execute(
      db,
      `INSERT INTO risk_assessments (id, request_id, score, recommendation, findings, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [assessmentId, requestId, assessment.score, assessment.recommendation, JSON.stringify(assessment.findings), now],
    );
    for (const finding of assessment.findings) {
      await execute(
        db,
        `INSERT INTO risk_alerts (id, assessment_id, request_id, severity, code, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), assessmentId, requestId, finding.severity, finding.code, finding.message, now],
      );
    }
    const nextStatus = assessment.recommendation === "deny" ? "rejected" : "pending_approval";
    if (!canTransition("submitted", nextStatus)) {
      throw new HttpError(409, "INVALID_STATE", "Transição de estado inválida.");
    }
    await execute(
      db,
      `UPDATE access_requests
       SET status = ?, decision_justification = ?, updated_at = ?
       WHERE id = ? AND status = 'submitted'`,
      [
        nextStatus,
        nextStatus === "rejected" ? assessment.findings.map((item) => item.message).join(" ") : null,
        now,
        requestId,
      ],
    );
    await recordSideEffects(db, null, requestId, "access_request.risk_assessed", "access_request.risk_assessed", {
      requestId,
      recommendation: assessment.recommendation,
      score: assessment.score,
    });

    const stored = await queryRows<RequestRow>(db, `${selectRequest} WHERE r.id = ?`, [requestId]);
    const row = stored[0];
    if (!row) throw new HttpError(500, "INTERNAL", "Erro interno.");
    return mapRequest(
      row,
      { score: assessment.score, recommendation: assessment.recommendation, findings: assessment.findings },
      assessment.findings,
    );
  });
}

export async function listRequests(
  actor: CurrentUser,
  filters: { status?: string; beneficiaryId?: string; page: number; pageSize: number },
) {
  const visibility = scope(actor);
  const where = [visibility.sql];
  const params: Array<string | number | null> = [...visibility.params];
  if (filters.status) {
    where.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.beneficiaryId) {
    where.push("r.beneficiary_id = ?");
    params.push(filters.beneficiaryId);
  }
  const clause = where.join(" AND ");
  return withTransaction(async (db) => {
    const totalRow = await queryRows<RowDataPacket>(
      db,
      `SELECT COUNT(*) AS total ${selectRequest.slice(selectRequest.indexOf("FROM"))} WHERE ${clause}`,
      params,
    );
    const offset = (filters.page - 1) * filters.pageSize;
    const data = await queryRows<RequestRow>(
      db,
      `${selectRequest} WHERE ${clause} ORDER BY r.created_at DESC LIMIT ${filters.pageSize} OFFSET ${offset}`,
      params,
    );
    return {
      data: data.map((row) => mapRequest(row)),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(totalRow[0]?.total ?? 0),
    };
  });
}

async function loadVisible(actor: CurrentUser, id: string): Promise<RequestRow> {
  const visibility = scope(actor);
  const found = await queryRows<RequestRow>(
    getPool(),
    `${selectRequest} WHERE r.id = ? AND ${visibility.sql} LIMIT 1`,
    [id, ...visibility.params],
  );
  const row = found[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Solicitação não encontrada.");
  return row;
}

export async function getRequest(actor: CurrentUser, id: string) {
  const row = await loadVisible(actor, id);
  const pool = getPool();
  const assessments = await queryRows<RowDataPacket>(
    pool,
    "SELECT score, recommendation, findings, created_at FROM risk_assessments WHERE request_id = ? LIMIT 1",
    [id],
  );
  const alerts = await queryRows<RowDataPacket>(
    pool,
    "SELECT severity, code, message, created_at FROM risk_alerts WHERE request_id = ? ORDER BY created_at",
    [id],
  );
  const assessment = assessments[0];
  return mapRequest(
    row,
    assessment
      ? {
          score: Number(assessment.score),
          recommendation: assessment.recommendation,
          findings: assessment.findings,
          createdAt: iso(assessment.created_at as Date),
        }
      : null,
    alerts.map((alert) => ({
      severity: alert.severity,
      code: alert.code,
      message: alert.message,
      createdAt: iso(alert.created_at as Date),
    })),
  );
}

function assertCanDecide(actor: CurrentUser, row: RequestRow) {
  if (actor.id === row.requester_id || actor.id === row.beneficiary_id) {
    throw new HttpError(403, "FORBIDDEN", "Autoaprovação não é permitida.");
  }
  const manages = actor.role === "manager" && row.beneficiary_manager_id === actor.id;
  if (actor.role !== "admin" && !manages) {
    throw new HttpError(403, "FORBIDDEN", "Você não pode decidir esta solicitação.");
  }
}

async function decide(actor: CurrentUser, id: string, status: "approved" | "rejected", justification: string | null) {
  return withTransaction(async (db) => {
    const found = await queryRows<RequestRow>(db, `${selectRequest} WHERE r.id = ? LIMIT 1 FOR UPDATE`, [id]);
    const row = found[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "Solicitação não encontrada.");
    const visibility = scope(actor);
    const visible = await queryRows<RowDataPacket>(db, `SELECT r.id ${selectRequest.slice(selectRequest.indexOf("FROM"))} WHERE r.id = ? AND ${visibility.sql}`, [
      id,
      ...visibility.params,
    ]);
    if (visible.length === 0) throw new HttpError(404, "NOT_FOUND", "Solicitação não encontrada.");
    assertCanDecide(actor, row);
    if (!canTransition(row.status, status)) {
      throw new HttpError(409, "INVALID_STATE", "Esta solicitação não pode mudar para o estado pedido.");
    }
    const now = sqlNow();
    const updated = await execute(
      db,
      `UPDATE access_requests
       SET status = ?, decision_by = ?, decision_justification = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
      [status, actor.id, justification, now, id, row.status],
    );
    if (updated.affectedRows !== 1) {
      throw new HttpError(409, "INVALID_STATE", "Esta solicitação não pode mudar para o estado pedido.");
    }
    const eventType = status === "approved" ? "access_request.approved" : "access_request.rejected";
    await recordSideEffects(db, actor.id, id, eventType, eventType, { requestId: id, status });
    const stored = await queryRows<RequestRow>(db, `${selectRequest} WHERE r.id = ?`, [id]);
    const saved = stored[0];
    if (!saved) throw new HttpError(500, "INTERNAL", "Erro interno.");
    return mapRequest(saved);
  });
}

export function approveRequest(actor: CurrentUser, id: string) {
  return decide(actor, id, "approved", null);
}

export function rejectRequest(actor: CurrentUser, id: string, justification: string) {
  return decide(actor, id, "rejected", justification);
}

export async function revokeGrant(actor: CurrentUser, id: string, justification: string) {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new HttpError(403, "FORBIDDEN", "Você não pode revogar concessões.");
  }
  return withTransaction(async (db) => {
    const found = await queryRows<RowDataPacket>(
      db,
      `SELECT g.id, g.user_id, g.status, u.manager_id
       FROM access_grants g JOIN users u ON u.id = g.user_id
       WHERE g.id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    const grant = found[0];
    if (!grant) throw new HttpError(404, "NOT_FOUND", "Concessão não encontrada.");
    const manages = actor.role === "manager" && grant.manager_id === actor.id;
    if (actor.role !== "admin" && !manages) {
      throw new HttpError(403, "FORBIDDEN", "Você não pode revogar esta concessão.");
    }
    if (grant.status !== "active") {
      throw new HttpError(409, "INVALID_STATE", "Só uma concessão ativa pode ser revogada.");
    }
    const now = sqlNow();
    await execute(
      db,
      `UPDATE access_grants SET status = 'revoked', active_marker = NULL, revoked_at = ? WHERE id = ? AND status = 'active'`,
      [now, id],
    );
    await execute(
      db,
      `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, payload, created_at)
       VALUES (?, ?, 'access_grant.revoked', 'access_grant', ?, ?, ?)`,
      [randomUUID(), actor.id, id, JSON.stringify({ justification }), now],
    );
    await execute(
      db,
      `INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, payload, status, attempts, available_at, created_at)
       VALUES (?, 'access_grant', ?, 'access_grant.revoked', ?, 'pending', 0, ?, ?)`,
      [randomUUID(), id, JSON.stringify({ grantId: id }), now, now],
    );
    return { id, status: "revoked" };
  });
}
