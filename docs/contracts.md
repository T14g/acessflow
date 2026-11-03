# Contratos do AccessFlow

Esta etapa descreve o produto antes da implementação. Não há servidor, migração executada nem tela funcional.

Documentos:

- [Modelo relacional](data-model.md)
- [API REST](api.md)
- [Eventos e outbox](events.md)
- [Domínio e papéis](domain.md)
- [Arquitetura](architecture.md)

O banco é MySQL 8.3, tabelas InnoDB. PostgreSQL não faz parte do projeto.

## Módulos

Continuam no mesmo processo da API. Nenhum vira serviço separado.

| Módulo | Cobre |
| --- | --- |
| `identity` | Login de demonstração, usuários e papéis |
| `catalog` | Sistemas fictícios e perfis de acesso |
| `access-requests` | Solicitação e aprovação ou recusa |
| `access-guard` | Avaliação e alertas de risco |
| `provisioning` | Conector simulado e concessões |
| `audit` | Trilha append-only |
| `outbox` | Evento na mesma transação e consumo idempotente |

Concessões (`access_grants`) ficam com o provisionamento. Aprovação fica com `access-requests`. O AccessGuard não provisiona.

## Como os módulos poderiam se separar depois

Cada módulo já tem fronteira de rotas, serviço e repositório. O que cruza a fronteira hoje é chamada direta ou um evento da outbox. No futuro, um módulo poderia virar processo próprio consumindo a mesma tabela de outbox, ou uma fila, sem mudar o nome dos eventos. Isso não será feito agora: não há rede entre módulos, nem banco por serviço.

## Decisões desta etapa

- Papéis da aplicação: `employee`, `manager`, `admin` e `security_analyst`. O analista existe para ler alertas e auditoria sem poder administrar usuários nem aprovar solicitações.
- O colaborador pede acesso para si. Só o `admin` informa outro beneficiário.
- Recusa exige justificativa. Autoaprovação é proibida.
- Perfil privilegiado nunca é provisionado sem aprovação humana.
- Ids `CHAR(36)` gerados na aplicação. Datas `DATETIME(3)` em UTC. Payload de evento em `JSON`.
- Uma concessão ativa por usuário e perfil, com índice único que permite várias linhas revogadas.
- Expiração também passa pela outbox: o evento fica disponível em `expires_at`.

## Pendências

- O PDF da sequência seguinte chega a cortar o prompt do worker no meio. O contrato em [events.md](events.md) é o que a implementação deve seguir.
- Banco `accessflow`, usuário limitado e `.env` real ainda não existem.
- Nenhuma rota está implementada. Healthcheck, login, fluxo de IAM, worker e interface vêm nas etapas posteriores.
- A varredura de expiração depende do worker, que ainda não existe.
- O narrador opcional de IA continua desligado e fora do contrato REST.
