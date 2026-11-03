const allowed: Record<string, readonly string[]> = {
  submitted: ["pending_approval", "rejected"],
  pending_approval: ["approved", "rejected"],
  approved: ["provisioning"],
  provisioning: ["provisioned", "failed"],
  failed: ["provisioning"],
  rejected: [],
  provisioned: [],
};

export function canTransition(from: string, to: string): boolean {
  return (allowed[from] ?? []).includes(to);
}
