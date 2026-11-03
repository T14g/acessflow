# ADR 0007: Papéis da aplicação

- Status: aceito
- Data: 2026-11-03

## Contexto

O fluxo precisa de quem pede, de quem aprova e de quem administra. Alertas de risco e auditoria não devem exigir o mesmo poder de quem concede acesso.

## Decisão

Os papéis são `employee`, `manager`, `admin` e `security_analyst`.

O colaborador solicita só para si. O administrador pode indicar outro beneficiário. O analista lê solicitações, concessões, alertas e auditoria, e não aprova, não revoga e não gerencia usuários.

Autoaprovação é proibida para todos os papéis. O papel usado na autorização é o da sessão, nunca um campo enviado pelo cliente.

## Consequências

Há quatro papéis, não um genérico de leitura. O contrato REST em [docs/api.md](../api.md) lista o alcance de cada um.
