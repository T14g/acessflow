# Eventos e transactional outbox

A mudança de negócio e a linha em `outbox_events` acontecem na mesma transação MySQL. Se o commit falha, não existe evento. Se o processo cai depois do commit, o evento continua `pending`.

Não há Redis nem Kafka. O worker é um processo Node. Em desenvolvimento ele pode rodar dentro da API com `ACCESSFLOW_EMBED_WORKER=true`. O processo separado é o modo em que o consumo fica isolado da API.

## Eventos

| event_type | Quando é gravado | Efeito no worker |
| --- | --- | --- |
| `access_request.submitted` | Criação da solicitação | Roda o AccessGuard e grava avaliação e alertas |
| `access_request.risk_assessed` | Fim da avaliação | Se a recomendação for `deny`, recusa. Senão deixa `pending_approval` |
| `access_request.approved` | Aprovação humana | Marca `provisioning` e grava `provisioning.requested` |
| `access_request.rejected` | Recusa | Nenhum provisionamento |
| `provisioning.requested` | Pedido de concessão | Chama o conector simulado |
| `provisioning.completed` | Conector ok | Cria `access_grants` ativo e a membership fictícia |
| `provisioning.failed` | Conector falhou | Solicitação fica `failed`, sem concessão ativa |
| `access_grant.revoked` | Revogação | Remove a membership e marca a concessão `revoked` |
| `access_grant.expire_due` | Na criação da concessão, com `available_at = expires_at` | Marca `expired` e remove a membership |

O payload traz ids e o estado esperado. Não traz senha nem hash.

## Reserva

Dentro de uma transação:

```sql
SELECT id, event_type, payload, attempts
FROM outbox_events
WHERE status = 'pending' AND available_at <= UTC_TIMESTAMP(3)
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED
```

As linhas selecionadas passam para `processing`. Dois workers não pegam a mesma linha. A tabela precisa ser InnoDB.

## Idempotência

O handler pode rodar de novo depois de um crash entre o efeito e o `processed`.

- Avaliar de novo a mesma solicitação regrava a mesma `risk_assessments` (uma linha por `request_id`).
- Aprovar de novo não cria segundo `provisioning.requested` se ele já existe para aquele `access_request`.
- Provisionar de novo não cria segunda concessão: `access_grants.request_id` é único, e o marcador ativo impede outro acesso vivo ao mesmo perfil.
- Revogar ou expirar de novo, com a concessão já fora de `active`, só confirma o estado e marca o evento `processed`.

## Falha e retentativa

Erro do handler incrementa `attempts`, grava `last_error` sem dados sensíveis e devolve a linha para `pending` com `available_at` no futuro. A espera dobra a cada tentativa, com teto de 15 minutos. Depois de 8 tentativas o status fica `failed` e a solicitação de provisionamento, se for o caso, fica `failed`.

`failed` na outbox não apaga a linha. Uma ação administrativa futura pode reabrir; nesta etapa não há endpoint para isso.

O conector simulado tem resultado explícito. Uma falha de negócio grava `provisioning.failed` e não entra em retentativa. O diretório fictício recusa o perfil quando a justificativa contém `recusa-simulada`. Falha técnica (erro de transação) entra na retentativa.

## Concorrência com a API

A API muda estado com `UPDATE ... WHERE id = ? AND status = ?`. Zero linhas atualizadas viram `INVALID_STATE`. Assim uma aprovação repetada ou uma corrida entre dois gestores não aplica o efeito duas vezes.
