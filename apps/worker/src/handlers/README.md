# handlers

Os handlers idempotentes ficam em `apps/api/src/modules/outbox/worker.ts`, para a API e o processo separado usarem o mesmo código. Este processo só carrega essa entrada.
