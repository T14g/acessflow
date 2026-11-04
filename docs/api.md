# API REST

Prefixo `/api/v1`. JSON. Cookie de sessão `httpOnly` e `SameSite=Lax`. O papel vem da sessão no servidor. Corpo e query não escolhem o papel.

A API descrita abaixo está implementada. O AccessGuard roda na mesma transação da criação da solicitação, para a fila já ficar utilizável antes do worker. A resposta 201 inclui a avaliação. A aprovação deixa a solicitação em `approved`; o worker passa a `provisioned` ou `failed`.

## Erros

Resposta de erro, sem stack:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Justificativa obrigatória.",
    "details": [{ "path": "justification", "message": "Obrigatório." }]
  }
}
```

| HTTP | code | Quando |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Corpo ou query inválidos |
| 401 | `UNAUTHENTICATED` | Sem sessão válida |
| 403 | `FORBIDDEN` | Papel insuficiente ou autoaprovação |
| 404 | `NOT_FOUND` | Registro inexistente ou fora do alcance de quem lê |
| 409 | `CONFLICT` | Solicitação aberta duplicada ou concessão ativa duplicada |
| 409 | `INVALID_STATE` | Transição de estado não permitida |
| 429 | `RATE_LIMITED` | Excesso de tentativas de login |
| 500 | `INTERNAL` | Falha inesperada, mensagem genérica |

## Paginação

Listas aceitam `page` (default 1) e `pageSize` (default 20, máximo 100).

```json
{ "data": [], "page": 1, "pageSize": 20, "total": 0 }
```

## Saúde

`GET /health` não exige sessão.

```json
{ "status": "ok" }
```

## Autenticação

`POST /api/v1/auth/login`

Entrada: `{ "email": "ana.costa@helios.example", "password": "..." }`.

Sucesso 200: `{ "user": { "id", "displayName", "email", "role" } }` e `Set-Cookie`. Senha incorreta ou usuário inativo: 401, mesma mensagem nos dois casos.

`POST /api/v1/auth/logout` revoga a sessão e limpa o cookie. Exige sessão.

`GET /api/v1/auth/me` devolve o usuário da sessão.

## Usuários

`GET /api/v1/users` — `admin`. Filtros `role`, `q` (nome ou e-mail) e paginação.

`GET /api/v1/users/:id` — o próprio usuário, o gestor dele, `admin` ou `security_analyst`.

Não há endpoint para o cliente enviar o próprio papel.

## Catálogo

`GET /api/v1/systems` — qualquer sessão ativa. Paginação.

`GET /api/v1/systems/:systemId/profiles` — perfis daquele sistema, incluindo `privileged`.

## Solicitações

`POST /api/v1/access-requests`

```json
{
  "profileId": "uuid",
  "justification": "Preciso emitir nota fiscal no fechamento.",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "beneficiaryId": "uuid"
}
```

`justification` é obrigatória, até 1000 caracteres. `expiresAt` é opcional e precisa estar no futuro. `beneficiaryId` só é aceito se a sessão for `admin`; nos outros papéis o beneficiário é o usuário autenticado.

Efeito, na mesma transação: grava a solicitação em `submitted`, grava `access_request.submitted` na outbox, avalia o risco e devolve a nota no 201. O worker só repete a avaliação se a linha de `risk_assessments` não existir.

`GET /api/v1/access-requests` — filtros `status` e `beneficiaryId`.

- `employee` vê as próprias;
- `manager` vê as dos subordinados e as próprias;
- `admin` e `security_analyst` veem todas.

`GET /api/v1/access-requests/:id` — mesma regra de alcance. Inclui a avaliação e os alertas quando já existirem.

`POST /api/v1/access-requests/:id/approve`

Sem corpo. Só `manager` do beneficiário, ou `admin`. O aprovador não pode ser o solicitante nem o beneficiário. Estado atual precisa ser `pending_approval`. Grava `access_request.approved` e o audit. O worker consome esse evento, grava `provisioning.requested` e chama o conector simulado. A justificativa que contém `recusa-simulada` termina em `failed`, sem concessão.

`POST /api/v1/access-requests/:id/reject`

```json
{ "justification": "Fora da função da equipe." }
```

`justification` obrigatória. Mesma autorização da aprovação. Grava `access_request.rejected`.

## Concessões

`GET /api/v1/access-grants` — filtros `userId` e `status` (`active`, `expired`, `revoked`). O alcance segue o das solicitações.

`POST /api/v1/access-grants/:id/revoke`

```json
{ "justification": "Desligamento fictício da função." }
```

`manager` do usuário ou `admin`. A concessão precisa estar `active`. Grava `access_grant.revoked` na outbox para o conector remover a membership simulada.

## Alertas

`GET /api/v1/risk-alerts` — `security_analyst` e `admin`. Filtro `severity`. Paginação.

`GET /api/v1/access-requests/:id` já mostra os alertas daquela solicitação a quem pode lê-la, inclusive o gestor.

## Auditoria

`GET /api/v1/audit-events` — `security_analyst` e `admin`. Filtros `entityType` e `entityId`. Paginação. Ordenação por `created_at` decrescente.

## O que a API não faz

- Não recebe papel no corpo para autorizar a ação.
- Não devolve `password_hash`, cookie cru nem stack.
- Não chama diretório externo, AWS nem OpenAI.
