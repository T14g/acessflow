export type ConnectorResult =
  | { ok: true; externalRef: string }
  | { ok: false; reason: string };

export const simulatedRefusalMarker = "recusa-simulada";

const maxDelaySeconds = 15 * 60;

export function retryDelaySeconds(attemptNumber: number): number {
  return Math.min(maxDelaySeconds, 2 ** attemptNumber);
}

export function simulateProvision(justification: string, userId: string): ConnectorResult {
  if (justification.includes(simulatedRefusalMarker)) {
    return { ok: false, reason: "Diretório fictício recusou o perfil." };
  }
  return { ok: true, externalRef: `helios:${userId}` };
}
