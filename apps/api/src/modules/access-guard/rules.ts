export type FindingCode =
  | "sod_conflict"
  | "privileged_profile"
  | "access_already_active"
  | "beneficiary_differs";

export type Recommendation = "require_approval" | "deny" | "allow_with_approval";

export type Finding = {
  code: FindingCode;
  severity: "low" | "medium" | "high";
  message: string;
};

const messages: Record<FindingCode, { severity: Finding["severity"]; message: string; weight: number; deny: boolean }> = {
  sod_conflict: {
    severity: "high",
    message: "O perfil conflita com um acesso já ativo do beneficiário.",
    weight: 80,
    deny: true,
  },
  access_already_active: {
    severity: "high",
    message: "O beneficiário já possui este perfil ativo.",
    weight: 70,
    deny: true,
  },
  privileged_profile: {
    severity: "medium",
    message: "O perfil é privilegiado e exige aprovação humana.",
    weight: 40,
    deny: false,
  },
  beneficiary_differs: {
    severity: "medium",
    message: "O solicitante é diferente do beneficiário.",
    weight: 30,
    deny: false,
  },
};

export function assessRisk(flags: Record<FindingCode, boolean>): {
  score: number;
  recommendation: Recommendation;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  let score = 10;
  let deny = false;
  for (const code of Object.keys(messages) as FindingCode[]) {
    if (!flags[code]) continue;
    const rule = messages[code];
    findings.push({ code, severity: rule.severity, message: rule.message });
    score += rule.weight;
    deny = deny || rule.deny;
  }
  score = Math.min(100, score);
  const recommendation: Recommendation = deny
    ? "deny"
    : findings.length > 0
      ? "require_approval"
      : "allow_with_approval";
  return { score, recommendation, findings };
}
