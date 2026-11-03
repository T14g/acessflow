# ADR 0003: Transactional outbox

- Status: aceito
- Data: 2026-11-03

## Contexto

A avaliação de risco e o provisionamento acontecem depois da mudança de estado. Uma fila externa (Redis, Kafka) pesa neste notebook e adiciona um serviço que o projeto não precisa.

## Decisão

A tabela `outbox_events` recebe o evento na mesma transação da escrita de negócio. O worker reserva linhas com `SELECT ... FOR UPDATE SKIP LOCKED`, aplica retentativa com backoff e exige handlers idempotentes.

No desenvolvimento, o worker roda dentro da API quando `ACCESSFLOW_EMBED_WORKER=true`. O processo separado existe para mostrar o mesmo código fora da API.

## Consequências

Não há perda do evento se a API cair depois do commit. Um handler repetido não pode criar uma segunda concessão. O teste desse reprocessamento faz parte da etapa do worker.
