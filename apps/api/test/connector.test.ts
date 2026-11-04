import { describe, expect, it } from "vitest";
import { retryDelaySeconds, simulateProvision } from "../src/modules/provisioning/connector.js";

describe("conector simulado", () => {
  it("concede uma referência fictícia", () => {
    const result = simulateProvision("Preciso consultar a folha.", "11111111-1111-4111-8111-111111111111");
    expect(result).toEqual({ ok: true, externalRef: "helios:11111111-1111-4111-8111-111111111111" });
  });

  it("recusa quando a justificativa pede a falha simulada", () => {
    const result = simulateProvision("teste: recusa-simulada", "11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
  });

  it("dobra a espera até o teto de 15 minutos", () => {
    expect(retryDelaySeconds(1)).toBe(2);
    expect(retryDelaySeconds(2)).toBe(4);
    expect(retryDelaySeconds(10)).toBe(15 * 60);
  });
});
