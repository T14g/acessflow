# AccessFlow

AccessFlow é um sistema **local e fictício** de gestão de acessos da empresa inventada Helios Indústria. O módulo **AccessGuard** calcula o risco de cada solicitação com regras determinísticas, sem rede e sem chave de IA.

O fluxo cobre pedido, avaliação, aprovação e provisionamento simulado, com API REST, banco relacional, eventos, testes e decisões de arquitetura registradas.

A especificação está em [docs/contracts.md](docs/contracts.md). A API e uma página local já sobem. O worker e o conector simulado ainda não rodam: a aprovação grava o evento na outbox e para em `approved`.

## Limites

- Os dados são fictícios. Não há pessoas, empresas nem contas reais.
- O diretório é uma tabela local. Não há conexão com Active Directory, Azure AD ou LDAP.
- O banco é o MySQL 8.3 já instalado nesta máquina. PostgreSQL não faz parte do projeto.
- Não há Docker, Kubernetes, AWS nem outro serviço pago.
- A OpenAI é opcional, desligada por padrão, e nunca é necessária para o funcionamento.
- Não existe rota vulnerável ativa. Demonstrações de falha ficam em testes isolados, nos incrementos seguintes, e o código de produção responde de forma segura.
- Segredos ficam só no `.env` local, que não é versionado.

## Stack prevista

| Área | Escolha |
| --- | --- |
| Frontend | React, TypeScript, Vite, Material UI, React Router, TanStack Query, React Hook Form, Zod |
| Backend | Node.js, TypeScript, Fastify, módulos em `apps/api` |
| Banco | MySQL 8.3 local, driver `mysql2`, tabelas InnoDB, migrações SQL |
| Eventos | Transactional outbox na mesma transação e worker Node |
| Provisionamento | Conector local simulado |
| Testes | Vitest |
| IA | Desligada. Narrador local fixo; adaptador OpenAI só se for ligado de propósito |

As decisões estão em [docs/architecture.md](docs/architecture.md) e em [docs/adr](docs/adr).

## Pré-requisitos

- Node.js 24
- npm 11
- Git
- MySQL 8.3 local em `127.0.0.1:3306`

Crie o banco e o usuário da aplicação no HeidiSQL, com a conta administrativa que você já usa. Essa senha não entra no Git. O usuário abaixo é só do laboratório:

```sql
CREATE DATABASE IF NOT EXISTS accessflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'accessflow'@'127.0.0.1' IDENTIFIED BY 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON accessflow.* TO 'accessflow'@'127.0.0.1';
FLUSH PRIVILEGES;
```

## Variáveis previstas

Copie [.env.example](.env.example) para `.env`. O valor `change-me` é a senha local do usuário `accessflow`, não a senha administrativa do MySQL.

- `DATABASE_URL` — conexão do usuário limitado ao schema `accessflow`
- `SESSION_SECRET` — segredo do cookie de sessão
- `ACCESSFLOW_EMBED_WORKER` — reservada para o worker. Hoje ele não sobe, então o valor fica `false`
- `ACCESSFLOW_AI_ENABLED` — permanece `false`

## Comandos

No PowerShell, nesta pasta:

```text
npm install
copy .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` sobe a API em `http://127.0.0.1:3000` e a página em `http://localhost:5173`. Ctrl+C encerra os dois. `npm test` roda as regras sem MySQL e, se `DATABASE_URL` existir, os testes da API.

O worker ainda não sobe. O AccessGuard roda dentro da criação da solicitação para a fila do gestor já funcionar. O evento continua sendo gravado na outbox.

## Credenciais de demonstração

Senha de todas: `Helios-demo-1`.

| E-mail | Papel |
| --- | --- |
| ana.costa@helios.example | colaborador |
| bruno.lima@helios.example | gestor da Ana e da Clara |
| clara.nunes@helios.example | administrador |
| diego.alves@helios.example | analista de segurança |

## Próximas etapas

1. Backend local: feito. Healthcheck, migração, seed, login e autorização.
2. Fluxo de IAM: feito na API e numa página simples. Catálogo, solicitação, aprovação, recusa e auditoria.
3. Outbox, worker em processo separado e conector simulado, idempotentes.
4. Interface: fila do gestor, risco e trilha.
5. Testes de integração do fluxo e testes isolados de segurança. O narrador de IA continua desligado.

O roteiro está em [docs/roadmap.md](docs/roadmap.md).
