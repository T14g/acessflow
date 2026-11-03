import { z } from "zod";

export const roles = ["employee", "manager", "admin", "security_analyst"] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

export const requestStatuses = [
  "submitted",
  "pending_approval",
  "rejected",
  "approved",
  "provisioning",
  "provisioned",
  "failed",
] as const;

export const recommendations = ["require_approval", "deny", "allow_with_approval"] as const;

export const eventTypes = [
  "access_request.submitted",
  "access_request.risk_assessed",
  "access_request.approved",
  "access_request.rejected",
  "provisioning.requested",
  "provisioning.completed",
  "provisioning.failed",
  "access_grant.revoked",
  "access_grant.expire_due",
] as const;

export const loginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(200),
});

export const createRequestSchema = z.object({
  profileId: z.string().uuid(),
  justification: z.string().trim().min(1).max(1000),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  beneficiaryId: z.string().uuid().optional(),
});

export const rejectSchema = z.object({
  justification: z.string().trim().min(1).max(1000),
});

export const revokeSchema = z.object({
  justification: z.string().trim().min(1).max(1000),
});

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string().email(),
  role: roleSchema,
});

export type PublicUser = z.infer<typeof publicUserSchema>;
