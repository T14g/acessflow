# ADR 0005: Diretório simulado

- Status: aceito
- Data: 2026-11-03

## Contexto

O fluxo de IAM fica incompleto sem um efeito depois da aprovação. Conectar Active Directory, Azure AD ou LDAP usaria contas reais e sairia do escopo local e fictício.

## Decisão

O conector de provisionamento escreve em `directory_accounts` e `directory_memberships` no mesmo MySQL. Não há LDAP, SCIM nem rede. Os registros são fictícios e nascem do seed ou do próprio conector.

Cada concessão relevante também gera linha na trilha de auditoria.

## Consequências

O fluxo de pedido, aprovação e efeito no diretório fica na máquina local. O conector não serve como integração com um diretório verdadeiro.
