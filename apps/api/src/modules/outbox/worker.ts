import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { Db } from "../../db/pool.js";
import { execute, queryRows, withTransaction } from "../../db/pool.js";
import { sqlNow } from "../../db/time.js";
import { assessRisk, type FindingCode } from "../access-guard/rules.js";
import { retryDelaySeconds, simulateProvision } from "../provisioning/connector.js";

const maxAttempts = 8;

type OutboxRow = RowDataPacket & {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
  attempts: number;
};

export type ProcessResult = { processed: false } | { processed: true; eventType: string };

function readPayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function requestIdOf(row: OutboxRow): string {
  const requestId = readPayload(row.payload).requestId;
  return typeof requestId === "string" ? requestId : row.aggregate_id;
}

function safeError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return (code ? `Falha técnica ${code}` : "Falha técnica no worker.").slice(0, 500);
}

async function ensureEvent(
  db: Db,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  availableAt?: string,
) {
  const found = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM outbox_events WHERE aggregate_id = ? AND event_type = ? LIMIT 1",
    [aggregateId, eventType],
  );
  if (found.length > 0) return;
  const now = sqlNow();
  await execute(
    db,
    `INSERT INTO outbox_events
      (id, aggregate_type, aggregate_id, event_type, payload, status, attempts, available_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [randomUUID(), aggregateType, aggregateId, eventType, JSON.stringify(payload), availableAt ?? now, now],
  );
}

async function audit(db: Db, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  await execute(
    db,
    `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, payload, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    [randomUUID(), action, entityType, entityId, JSON.stringify(payload), sqlNow()],
  );
}

async function onSubmitted(db: Db, requestId: string) {
  const requests = await queryRows<RowDataPacket>(
    db,
    "SELECT id, requester_id, beneficiary_id, profile_id, status FROM access_requests WHERE id = ? LIMIT 1 FOR UPDATE",
    [requestId],
  );
  const request = requests[0];
  if (!request) return;
  const existing = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM risk_assessments WHERE request_id = ? LIMIT 1",
    [requestId],
  );
  if (existing.length > 0) return;

  const profileId = String(request.profile_id);
  const beneficiaryId = String(request.beneficiary_id);
  const profiles = await queryRows<RowDataPacket>(db, "SELECT privileged FROM profiles WHERE id = ? LIMIT 1", [profileId]);
  const conflicts = await queryRows<RowDataPacket>(
    db,
    `SELECT g.id
     FROM sod_conflicts c
     JOIN access_grants g
       ON g.profile_id = IF(c.profile_a_id = ?, c.profile_b_id, c.profile_a_id)
      AND g.user_id = ? AND g.status = 'active'
     WHERE c.profile_a_id = ? OR c.profile_b_id = ?
     LIMIT 1`,
    [profileId, beneficiaryId, profileId, profileId],
  );
  const activeGrant = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM access_grants WHERE user_id = ? AND profile_id = ? AND status = 'active' LIMIT 1",
    [beneficiaryId, profileId],
  );
  const flags: Record<FindingCode, boolean> = {
    sod_conflict: conflicts.length > 0,
    privileged_profile: Boolean(profiles[0]?.privileged),
    access_already_active: activeGrant.length > 0,
    beneficiary_differs: String(request.requester_id) !== beneficiaryId,
  };
  const assessment = assessRisk(flags);
  const now = sqlNow();
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
  if (request.status === "submitted") {
    await execute(
      db,
      `UPDATE access_requests
       SET status = ?, decision_justification = ?, updated_at = ?
       WHERE id = ? AND status = 'submitted'`,
      [nextStatus, nextStatus === "rejected" ? assessment.findings.map((item) => item.message).join(" ") : null, now, requestId],
    );
  }
  await ensureEvent(db, "access_request", requestId, "access_request.risk_assessed", {
    requestId,
    recommendation: assessment.recommendation,
    score: assessment.score,
  });
}

async function onRiskAssessed(db: Db, requestId: string) {
  const requests = await queryRows<RowDataPacket>(
    db,
    "SELECT status FROM access_requests WHERE id = ? LIMIT 1 FOR UPDATE",
    [requestId],
  );
  const request = requests[0];
  if (!request || request.status !== "submitted") return;
  const assessments = await queryRows<RowDataPacket>(
    db,
    "SELECT recommendation, findings FROM risk_assessments WHERE request_id = ? LIMIT 1",
    [requestId],
  );
  const assessment = assessments[0];
  if (!assessment) return;
  const nextStatus = assessment.recommendation === "deny" ? "rejected" : "pending_approval";
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const note = findings
    .map((item) => (item && typeof item === "object" && "message" in item ? String(item.message) : ""))
    .filter((item) => item.length > 0)
    .join(" ");
  await execute(
    db,
    `UPDATE access_requests SET status = ?, decision_justification = ?, updated_at = ? WHERE id = ? AND status = 'submitted'`,
    [nextStatus, nextStatus === "rejected" ? note : null, sqlNow(), requestId],
  );
}

async function onApproved(db: Db, requestId: string) {
  const requests = await queryRows<RowDataPacket>(
    db,
    "SELECT status FROM access_requests WHERE id = ? LIMIT 1 FOR UPDATE",
    [requestId],
  );
  const status = String(requests[0]?.status ?? "");
  if (status === "approved") {
    await execute(
      db,
      "UPDATE access_requests SET status = 'provisioning', updated_at = ? WHERE id = ? AND status = 'approved'",
      [sqlNow(), requestId],
    );
  }
  if (status === "approved" || status === "provisioning") {
    await ensureEvent(db, "access_request", requestId, "provisioning.requested", { requestId });
  }
}

async function onProvisioningRequested(db: Db, requestId: string) {
  const requests = await queryRows<RowDataPacket>(
    db,
    `SELECT id, status, justification, beneficiary_id
     FROM access_requests WHERE id = ? LIMIT 1 FOR UPDATE`,
    [requestId],
  );
  const request = requests[0];
  if (!request) return;
  const settled = await queryRows<RowDataPacket>(
    db,
    `SELECT id FROM outbox_events
     WHERE aggregate_id = ? AND event_type IN ('provisioning.completed', 'provisioning.failed')
     LIMIT 1`,
    [requestId],
  );
  if (settled.length > 0) return;
  const grants = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM access_grants WHERE request_id = ? LIMIT 1",
    [requestId],
  );
  if (grants.length > 0) return;
  const result = simulateProvision(String(request.justification), String(request.beneficiary_id));
  if (!result.ok) {
    await ensureEvent(db, "access_request", requestId, "provisioning.failed", { requestId, reason: result.reason });
    return;
  }
  await ensureEvent(db, "access_request", requestId, "provisioning.completed", {
    requestId,
    externalRef: result.externalRef,
  });
}

async function onProvisioningCompleted(db: Db, requestId: string) {
  const requests = await queryRows<RowDataPacket>(
    db,
    `SELECT id, beneficiary_id, profile_id, expires_at, status
     FROM access_requests WHERE id = ? LIMIT 1 FOR UPDATE`,
    [requestId],
  );
  const request = requests[0];
  if (!request) return;
  const beneficiaryId = String(request.beneficiary_id);
  const profileId = String(request.profile_id);
  const expiresAt = request.expires_at instanceof Date ? sqlNow(request.expires_at) : null;
  const now = sqlNow();

  const existingGrants = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM access_grants WHERE request_id = ? LIMIT 1",
    [requestId],
  );
  let grantId = existingGrants[0] ? String(existingGrants[0].id) : "";
  if (!grantId) {
    grantId = randomUUID();
    await execute(
      db,
      `INSERT INTO access_grants
        (id, user_id, profile_id, request_id, status, active_marker, granted_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, 'active', 1, ?, ?, NULL)`,
      [grantId, beneficiaryId, profileId, requestId, now, expiresAt],
    );
  }

  const accounts = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM directory_accounts WHERE user_id = ? LIMIT 1",
    [beneficiaryId],
  );
  let accountId = accounts[0] ? String(accounts[0].id) : "";
  if (!accountId) {
    accountId = randomUUID();
    await execute(
      db,
      "INSERT INTO directory_accounts (id, user_id, external_ref, status) VALUES (?, ?, ?, 'active')",
      [accountId, beneficiaryId, `helios:${beneficiaryId}`],
    );
  }

  const memberships = await queryRows<RowDataPacket>(
    db,
    "SELECT id FROM directory_memberships WHERE grant_id = ? LIMIT 1",
    [grantId],
  );
  if (memberships.length === 0) {
    await execute(
      db,
      `INSERT INTO directory_memberships (id, account_id, profile_id, grant_id, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [randomUUID(), accountId, profileId, grantId],
    );
  }

  const updated = await execute(
    db,
    "UPDATE access_requests SET status = 'provisioned', updated_at = ? WHERE id = ? AND status = 'provisioning'",
    [now, requestId],
  );
  if (updated.affectedRows === 1) {
    await audit(db, "provisioning.completed", "access_request", requestId, { requestId, grantId });
  }
  if (expiresAt) {
    await ensureEvent(db, "access_grant", grantId, "access_grant.expire_due", { grantId, requestId }, expiresAt);
  }
}

async function onProvisioningFailed(db: Db, requestId: string) {
  const updated = await execute(
    db,
    "UPDATE access_requests SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'provisioning'",
    [sqlNow(), requestId],
  );
  if (updated.affectedRows === 1) {
    await audit(db, "provisioning.failed", "access_request", requestId, { requestId });
  }
}

async function onRevoked(db: Db, grantId: string) {
  const now = sqlNow();
  await execute(
    db,
    `UPDATE access_grants
     SET status = 'revoked', active_marker = NULL, revoked_at = COALESCE(revoked_at, ?)
     WHERE id = ? AND status = 'active'`,
    [now, grantId],
  );
  await execute(db, "UPDATE directory_memberships SET status = 'revoked' WHERE grant_id = ? AND status <> 'revoked'", [
    grantId,
  ]);
}

async function onExpire(db: Db, grantId: string) {
  await execute(
    db,
    "UPDATE access_grants SET status = 'expired', active_marker = NULL WHERE id = ? AND status = 'active'",
    [grantId],
  );
  await execute(
    db,
    "UPDATE directory_memberships SET status = 'expired' WHERE grant_id = ? AND status = 'active'",
    [grantId],
  );
}

async function dispatch(db: Db, row: OutboxRow) {
  const requestId = requestIdOf(row);
  switch (row.event_type) {
    case "access_request.submitted":
      await onSubmitted(db, requestId);
      break;
    case "access_request.risk_assessed":
      await onRiskAssessed(db, requestId);
      break;
    case "access_request.approved":
      await onApproved(db, requestId);
      break;
    case "access_request.rejected":
      break;
    case "provisioning.requested":
      await onProvisioningRequested(db, requestId);
      break;
    case "provisioning.completed":
      await onProvisioningCompleted(db, requestId);
      break;
    case "provisioning.failed":
      await onProvisioningFailed(db, requestId);
      break;
    case "access_grant.revoked":
      await onRevoked(db, row.aggregate_id);
      break;
    case "access_grant.expire_due":
      await onExpire(db, row.aggregate_id);
      break;
    default:
      break;
  }
}

async function claim(db: Db, scope?: { requestId: string }): Promise<OutboxRow | undefined> {
  const params: string[] = [];
  let scopeSql = "";
  if (scope) {
    const grants = await queryRows<RowDataPacket>(db, "SELECT id FROM access_grants WHERE request_id = ?", [
      scope.requestId,
    ]);
    const ids = [scope.requestId, ...grants.map((row) => String(row.id))];
    scopeSql = ` AND aggregate_id IN (${ids.map(() => "?").join(", ")})`;
    params.push(...ids);
  }
  const [rows] = await db.query<OutboxRow[]>(
    `SELECT id, event_type, aggregate_id, payload, attempts
     FROM outbox_events
     WHERE status = 'pending' AND available_at <= UTC_TIMESTAMP(3)${scopeSql}
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    params,
  );
  return rows[0];
}

async function recordFailure(eventId: string, attempts: number, eventType: string, requestId: string, error: unknown) {
  const nextAttempt = attempts + 1;
  const giveUp = nextAttempt >= maxAttempts;
  const availableAt = sqlNow(new Date(Date.now() + retryDelaySeconds(nextAttempt) * 1000));
  await withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE outbox_events
       SET attempts = ?, last_error = ?, status = ?, available_at = ?
       WHERE id = ? AND status = 'pending'`,
      [nextAttempt, safeError(error), giveUp ? "failed" : "pending", availableAt, eventId],
    );
    if (giveUp && eventType.startsWith("provisioning.")) {
      await execute(
        db,
        "UPDATE access_requests SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'provisioning'",
        [sqlNow(), requestId],
      );
    }
  });
}

export async function processAvailable(scope?: { requestId: string }): Promise<ProcessResult> {
  let eventId: string | undefined;
  let attempts = 0;
  let eventType = "";
  let requestId = "";
  try {
    return await withTransaction(async (db) => {
      const row = await claim(db, scope);
      if (!row) return { processed: false };
      eventId = row.id;
      attempts = Number(row.attempts);
      eventType = row.event_type;
      requestId = requestIdOf(row);
      await dispatch(db, row);
      await execute(db, "UPDATE outbox_events SET status = 'processed', processed_at = ? WHERE id = ?", [
        sqlNow(),
        row.id,
      ]);
      return { processed: true, eventType: row.event_type };
    });
  } catch (error) {
    if (!eventId) throw error;
    await recordFailure(eventId, attempts, eventType, requestId, error);
    return { processed: true, eventType };
  }
}

export async function drainRequest(requestId: string, limit = 40): Promise<number> {
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    const result = await processAvailable({ requestId });
    if (!result.processed) break;
    count += 1;
  }
  return count;
}

export function startWorker(): { stop: () => Promise<void> } {
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      let processed = false;
      try {
        processed = (await processAvailable()).processed;
      } catch {
        console.error("Worker não conseguiu ler a outbox.");
      }
      if (!processed && !stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await done;
    },
  };
}
