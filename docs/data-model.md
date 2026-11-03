# Modelo relacional

MySQL 8.3, banco `accessflow`, toda tabela `ENGINE=InnoDB`. Ids são `CHAR(36)`, gerados com `crypto.randomUUID()` antes do `INSERT`. Instantes são `DATETIME(3)` em UTC. Não há tipo `uuid` nativo nem `INSERT ... RETURNING`.

Apagar linha de auditoria ou de outbox já processada não faz parte da aplicação. O código não oferece `UPDATE` em `audit_events`.

## users

Pessoa fictícia da Helios Indústria.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| display_name | VARCHAR(120) | NOT NULL |
| email | VARCHAR(180) | NOT NULL, UNIQUE |
| password_hash | VARCHAR(255) | NOT NULL, scrypt |
| role | VARCHAR(32) | NOT NULL, um de `employee`, `manager`, `admin`, `security_analyst` |
| manager_id | CHAR(36) | NULL, FK `users.id` |
| status | VARCHAR(16) | NOT NULL, `active` ou `inactive` |
| created_at | DATETIME(3) | NOT NULL |

`manager_id` aponta para um usuário com papel `manager` ou `admin`. A aplicação recusa ciclo.

## sessions

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK, valor opaco do cookie |
| user_id | CHAR(36) | NOT NULL, FK `users.id` |
| expires_at | DATETIME(3) | NOT NULL |
| created_at | DATETIME(3) | NOT NULL |
| revoked_at | DATETIME(3) | NULL |

Sessão com `revoked_at` preenchido ou `expires_at` no passado não autentica.

## systems

Sistema fictício (ERP, VPN, folha). Não é um sistema real.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| code | VARCHAR(40) | NOT NULL, UNIQUE |
| name | VARCHAR(120) | NOT NULL |
| description | VARCHAR(500) | NOT NULL |

## profiles

Perfil de acesso dentro de um sistema. É o que se solicita.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| system_id | CHAR(36) | NOT NULL, FK `systems.id` |
| code | VARCHAR(40) | NOT NULL |
| name | VARCHAR(120) | NOT NULL |
| privileged | TINYINT(1) | NOT NULL |
| UNIQUE | | (`system_id`, `code`) |

## sod_conflicts

Par de perfis incompatíveis. A aplicação grava os ids em ordem lexicográfica para não duplicar o par invertido.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| profile_a_id | CHAR(36) | NOT NULL, FK `profiles.id` |
| profile_b_id | CHAR(36) | NOT NULL, FK `profiles.id` |
| UNIQUE | | (`profile_a_id`, `profile_b_id`) |

`profile_a_id` e `profile_b_id` são diferentes.

## access_requests

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| requester_id | CHAR(36) | NOT NULL, FK `users.id` |
| beneficiary_id | CHAR(36) | NOT NULL, FK `users.id` |
| profile_id | CHAR(36) | NOT NULL, FK `profiles.id` |
| justification | VARCHAR(1000) | NOT NULL |
| expires_at | DATETIME(3) | NULL, prazo pedido |
| status | VARCHAR(32) | NOT NULL |
| decision_by | CHAR(36) | NULL, FK `users.id` |
| decision_justification | VARCHAR(1000) | NULL |
| created_at | DATETIME(3) | NOT NULL |
| updated_at | DATETIME(3) | NOT NULL |

Estados: `submitted`, `pending_approval`, `rejected`, `approved`, `provisioning`, `provisioned`, `failed`.

Transições aceitas:

- `submitted` → `pending_approval` ou `rejected` (recusa direta do AccessGuard);
- `pending_approval` → `approved` ou `rejected`;
- `approved` → `provisioning`;
- `provisioning` → `provisioned` ou `failed`;
- `failed` → `provisioning`, numa nova tentativa do worker.

Qualquer outro salto é `INVALID_STATE`. A troca de estado é um `UPDATE` condicionado ao estado atual.

Recusa (`rejected`) exige `decision_justification`. `decision_by` não pode ser o `requester_id`.

Não pode existir outra solicitação aberta do mesmo beneficiário para o mesmo perfil. Aberta significa status em `submitted`, `pending_approval`, `approved` ou `provisioning`.

## access_grants

Acesso concedido, expirado ou revogado.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| user_id | CHAR(36) | NOT NULL, FK `users.id` |
| profile_id | CHAR(36) | NOT NULL, FK `profiles.id` |
| request_id | CHAR(36) | NOT NULL, UNIQUE, FK `access_requests.id` |
| status | VARCHAR(16) | NOT NULL, `active`, `expired` ou `revoked` |
| active_marker | TINYINT | NULL, vale `1` só enquanto `active` |
| granted_at | DATETIME(3) | NOT NULL |
| expires_at | DATETIME(3) | NULL |
| revoked_at | DATETIME(3) | NULL |
| UNIQUE | | (`user_id`, `profile_id`, `active_marker`) |

No MySQL, várias linhas com `active_marker` NULL passam no índice único. Por isso concessões expiradas e revogadas coexistem, e só uma ativa é possível.

## risk_assessments

Uma avaliação por solicitação.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| request_id | CHAR(36) | NOT NULL, UNIQUE, FK `access_requests.id` |
| score | TINYINT UNSIGNED | NOT NULL, 0 a 100 |
| recommendation | VARCHAR(32) | NOT NULL, `require_approval`, `deny` ou `allow_with_approval` |
| findings | JSON | NOT NULL |
| created_at | DATETIME(3) | NOT NULL |

`allow_with_approval` ainda exige gestor. Perfil privilegiado não recebe provisionamento automático.

## risk_alerts

Alerta derivado da avaliação. O analista e o administrador leem esta tabela.

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| assessment_id | CHAR(36) | NOT NULL, FK `risk_assessments.id` |
| request_id | CHAR(36) | NOT NULL, FK `access_requests.id` |
| severity | VARCHAR(16) | NOT NULL, `low`, `medium` ou `high` |
| code | VARCHAR(60) | NOT NULL |
| message | VARCHAR(500) | NOT NULL |
| created_at | DATETIME(3) | NOT NULL |

Códigos previstos: `sod_conflict`, `privileged_profile`, `access_already_active`, `beneficiary_differs`.

## audit_events

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| actor_id | CHAR(36) | NULL, FK `users.id` |
| action | VARCHAR(80) | NOT NULL |
| entity_type | VARCHAR(40) | NOT NULL |
| entity_id | CHAR(36) | NOT NULL |
| payload | JSON | NOT NULL |
| created_at | DATETIME(3) | NOT NULL |

O payload não guarda senha, hash nem cookie.

## outbox_events

| Campo | Tipo | Restrição |
| --- | --- | --- |
| id | CHAR(36) | PK |
| aggregate_type | VARCHAR(40) | NOT NULL |
| aggregate_id | CHAR(36) | NOT NULL |
| event_type | VARCHAR(80) | NOT NULL |
| payload | JSON | NOT NULL |
| status | VARCHAR(16) | NOT NULL, `pending`, `processing`, `processed` ou `failed` |
| attempts | INT | NOT NULL, default 0 |
| available_at | DATETIME(3) | NOT NULL |
| processed_at | DATETIME(3) | NULL |
| last_error | VARCHAR(500) | NULL |
| created_at | DATETIME(3) | NOT NULL |

Índice em (`status`, `available_at`) para o `SELECT ... FOR UPDATE SKIP LOCKED`.

## directory_accounts e directory_memberships

Diretório fictício. Sem LDAP.

`directory_accounts`: `id`, `user_id` UNIQUE, `external_ref` VARCHAR(80), `status`.

`directory_memberships`: `id`, `account_id`, `profile_id`, `grant_id` UNIQUE, `status`.

O conector só escreve aqui dentro da mesma transação que conclui o handler.
