# outbox

A API grava o evento na mesma transação da mudança de negócio. O processo `npm run dev:worker` reserva linhas com `SELECT ... FOR UPDATE SKIP LOCKED` e aplica os handlers idempotentes. Contrato em `docs/events.md`.
