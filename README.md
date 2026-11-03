# AccessFlow

AccessFlow é um sistema **local e fictício** de gestão de acessos da empresa inventada Helios Indústria. O módulo **AccessGuard** calcula o risco de cada solicitação com regras determinísticas, sem rede e sem chave de IA.

O fluxo cobre pedido, avaliação, aprovação e provisionamento simulado, com API REST, banco relacional, eventos, testes e decisões de arquitetura registradas.

A fundação e os contratos estão escritos: objetivo, limites, modelo de dados, API, eventos e decisões. A aplicação ainda não sobe. A especificação está em [docs/contracts.md](docs/contracts.md).

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

O banco `accessflow` e o usuário da aplicação ainda não existem. Eles entram na etapa de backend local e não usam a conta administrativa do HeidiSQL dentro do Git.

## Variáveis previstas

O arquivo [.env.example](.env.example) lista os nomes. Copie para `.env` somente quando a API existir. Valores de exemplo não são senhas reais.

- `DATABASE_URL` — conexão do usuário limitado ao schema `accessflow`
- `SESSION_SECRET` — segredo do cookie de sessão
- `ACCESSFLOW_EMBED_WORKER` — `true` embute o worker na API durante o desenvolvimento
- `ACCESSFLOW_AI_ENABLED` — permanece `false`

## Comandos planejados

Nenhum comando abaixo funciona ainda. Dependências, scripts e migrações entram na etapa de backend local.

```text
npm install
npm run db:migrate
npm run db:seed
npm run dev
npm test
```

Quando existirem, `npm run dev` sobe a API com o worker embutido e o Vite. `npm run dev:worker` sobe o worker num processo separado.

## Credenciais de demonstração

Ainda não há login. Na etapa de backend local, o seed criará usuários fictícios da Helios Indústria com senhas óbvias de demonstração, documentadas aqui. Elas não representam contas reais.

## Próximas etapas

1. Backend local: migração, seed fictício, healthcheck, login e testes de autorização.
2. Fluxo de IAM: catálogo, solicitação, aprovação, recusa e auditoria.
3. Outbox, worker em processo separado e conector simulado, idempotentes.
4. Interface: fila do gestor, risco e trilha.
5. Testes de integração do fluxo e testes isolados de segurança. O narrador de IA continua desligado.

O roteiro está em [docs/roadmap.md](docs/roadmap.md).
