# Roteiro

A fundação, os contratos, a API, uma página local e o worker da outbox estão no repositório.

## Feito

- Estrutura de pastas, limites e ADRs.
- [Contratos](contracts.md): módulos, papéis, [modelo MySQL](data-model.md), [API](api.md) e [outbox](events.md).
- Backend local: healthcheck, migração, seed, login e autorização.
- Fluxo de IAM na API e numa página: catálogo, solicitação, aprovação, recusa e auditoria.
- Outbox, worker Node separado e conector simulado. Reprocessar a mesma mensagem não cria outra concessão.

## 1. Backend local

Concluído.

## 2. Fluxo de IAM

Concluído na API e na página inicial. Sem autoaprovação, sem papel vindo do cliente, sem solicitação aberta duplicada.

## 3. Outbox, worker e conector

Concluído. O comando é `npm run dev:worker`. A justificativa com `recusa-simulada` provoca a falha de negócio do diretório fictício.

## 4. Interface

Fila do gestor, detalhe com a nota do AccessGuard e trilha de auditoria.

## 5. Fechamento dos testes

Integração do caminho feliz quando `DATABASE_URL` existir. Testes isolados que esperam rejeição de injeção de SQL, troca de id e escalação de papel. Narrador de IA desligado, com teste de funcionamento sem chave.
