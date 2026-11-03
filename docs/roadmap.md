# Roteiro

A fundação, os contratos, a API e uma página local estão no repositório. O worker ainda não consome a outbox.

## Feito

- Estrutura de pastas, limites e ADRs.
- [Contratos](contracts.md): módulos, papéis, [modelo MySQL](data-model.md), [API](api.md) e [outbox](events.md).
- Backend local: healthcheck, migração, seed, login e autorização.
- Fluxo de IAM na API e numa página: catálogo, solicitação, aprovação, recusa e auditoria. A falha de provisionamento está coberta pela regra de estado. O conector entra na etapa seguinte.

## 1. Backend local

Concluído.

## 2. Fluxo de IAM

Concluído na API e na página inicial. Sem autoaprovação, sem papel vindo do cliente, sem solicitação aberta duplicada.

## 3. Outbox, worker e conector

Evento na mesma transação, worker Node idempotente, retentativa e diretório simulado. Processar a mesma mensagem de novo não cria outra concessão.

## 4. Interface

Fila do gestor, detalhe com a nota do AccessGuard e trilha de auditoria.

## 5. Fechamento dos testes

Integração do caminho feliz quando `DATABASE_URL` existir. Testes isolados que esperam rejeição de injeção de SQL, troca de id e escalação de papel. Narrador de IA desligado, com teste de funcionamento sem chave.
