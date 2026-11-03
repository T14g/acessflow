# ADR 0001: Monólito modular

- Status: aceito
- Data: 2026-11-03

## Contexto

O AccessFlow separa os módulos de IAM, a API e o worker sem vários serviços, filas externas ou muitos processos ao mesmo tempo.

## Decisão

Um único repositório npm workspaces. A API Fastify é organizada por módulos (`identity`, `catalog`, `access-requests`, `access-guard`, `provisioning`, `audit`, `outbox`). O frontend fica em `apps/web`. O worker pode rodar embutido na API no desenvolvimento e em processo separado quando esse modo for necessário.

O contrato de eventos e os esquemas Zod compartilhados ficam em `packages/contracts`.

## Consequências

O código de cada módulo permanece encontrável. Não há rede entre módulos no processo da API. Três processos ao mesmo tempo são opt-in, não o padrão.
