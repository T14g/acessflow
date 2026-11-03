import { describe, expect, it } from "vitest";
import { assessRisk } from "../src/modules/access-guard/rules.js";
import { canTransition } from "../src/modules/access-requests/transitions.js";

const clear = {
  sod_conflict: false,
  privileged_profile: false,
  access_already_active: false,
  beneficiary_differs: false,
};

describe("AccessGuard", () => {
  it("pede aprovação humana quando não há sinal de risco", () => {
    const result = assessRisk(clear);
    expect(result.recommendation).toBe("allow_with_approval");
    expect(result.findings).toEqual([]);
  });

  it("recusa conflito de segregação de funções", () => {
    const result = assessRisk({ ...clear, sod_conflict: true, privileged_profile: true });
    expect(result.recommendation).toBe("deny");
    expect(result.findings.map((item) => item.code)).toContain("sod_conflict");
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("não provisiona perfil privilegiado sem pessoa", () => {
    const result = assessRisk({ ...clear, privileged_profile: true });
    expect(result.recommendation).toBe("require_approval");
  });
});

describe("transições", () => {
  it("permite falha de provisionamento a partir de provisioning", () => {
    expect(canTransition("provisioning", "failed")).toBe(true);
    expect(canTransition("provisioning", "provisioned")).toBe(true);
  });

  it("recusa salto direto para provisionado", () => {
    expect(canTransition("submitted", "provisioned")).toBe(false);
    expect(canTransition("approved", "provisioned")).toBe(false);
  });
});
