import { randomUUID } from "node:crypto";
import type { Role } from "@accessflow/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { HttpError } from "../../http-error.js";
import { verifyPassword } from "../../password.js";
import { execute, getPool, queryRows } from "../../db/pool.js";
import { iso, sqlNow } from "../../db/time.js";

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  managerId: string | null;
  status: string;
};

type UserRow = RowDataPacket & {
  id: string;
  display_name: string;
  email: string;
  password_hash?: string;
  role: Role;
  manager_id: string | null;
  status: string;
};

const publicColumns = "id, display_name, email, role, manager_id, status";

function mapUser(row: UserRow): CurrentUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    status: row.status,
  };
}

export function toPublic(user: CurrentUser) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
  };
}

export async function login(email: string, password: string): Promise<{ user: CurrentUser; sessionId: string }> {
  const found = await queryRows<UserRow>(
    getPool(),
    `SELECT ${publicColumns}, password_hash FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  const row = found[0];
  const matches = row?.password_hash ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !matches || row.status !== "active") {
    throw new HttpError(401, "UNAUTHENTICATED", "E-mail ou senha inválidos.");
  }
  const sessionId = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  await execute(
    getPool(),
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [sessionId, row.id, sqlNow(expires), sqlNow(now)],
  );
  return { user: mapUser(row), sessionId };
}

export async function userFromSession(sessionId: string): Promise<CurrentUser | null> {
  const pool = getPool();
  const found = await queryRows<UserRow>(
    pool,
    `SELECT u.id, u.display_name, u.email, u.role, u.manager_id, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'
     LIMIT 1`,
    [sessionId, sqlNow()],
  );
  const row = found[0];
  return row ? mapUser(row) : null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await execute(
    getPool(),
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    [sqlNow(), sessionId],
  );
}

export async function listUsers(filters: { role?: string; q?: string; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (filters.role) {
    where.push("role = ?");
    params.push(filters.role);
  }
  if (filters.q) {
    where.push("(display_name LIKE ? OR email LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getPool();
  const totalRow = await queryRows<RowDataPacket>(pool, `SELECT COUNT(*) AS total FROM users ${clause}`, params);
  const offset = (filters.page - 1) * filters.pageSize;
  const data = await queryRows<UserRow>(
    pool,
    `SELECT ${publicColumns} FROM users ${clause} ORDER BY display_name LIMIT ${filters.pageSize} OFFSET ${offset}`,
    params,
  );
  return {
    data: data.map((row) => toPublic(mapUser(row))),
    page: filters.page,
    pageSize: filters.pageSize,
    total: Number(totalRow[0]?.total ?? 0),
  };
}

export async function getUser(id: string): Promise<CurrentUser | null> {
  const found = await queryRows<UserRow>(
    getPool(),
    `SELECT ${publicColumns} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = found[0];
  return row ? mapUser(row) : null;
}

export function canReadUser(actor: CurrentUser, target: CurrentUser): boolean {
  if (actor.role === "admin" || actor.role === "security_analyst") return true;
  if (actor.id === target.id) return true;
  return actor.role === "manager" && target.managerId === actor.id;
}
