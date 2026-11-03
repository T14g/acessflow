# Roteiro

A fundação e os contratos estão documentados. Nenhum comando sobe a aplicação ainda.

## Feito

- Estrutura de pastas, limites e ADRs.
- [Contratos](contracts.md): módulos, papéis, [modelo MySQL](data-model.md), [API](api.md) e [outbox](events.md).

## 1. Backend local

Conexão com o MySQL 8.3, migrações reproduzíveis, seed fictício, `GET /health`, login de demonstração e checagem de papel. Testes de autenticação, validação e autorização. Banco `accessflow` e usuário limitado fora do Git.

## 2. Fluxo de IAM

Catálogo, solicitação com justificativa e prazo, aprovação e recusa, auditoria. Sem autoaprovação, sem papel vindo do cliente, sem solicitação aberta duplicada. Testes dos casos principais, inclusive falha de provisionamento quando o conector entrar na etapa seguinte. Até lá, a falha de provisionamento fica coberta pela regra de estado e pelo teste do conector na etapa 3.

## 3. Outbox, worker e conector

Evento na mesma transação, worker Node idempotente, retentativa e diretório simulado. Processar a mesma mensagem de novo não cria outra concessão.

## 4. Interface

Fila do gestor, detalhe com a nota do AccessGuard e trilha de auditoria.

## 5. Fechamento dos testes

Integração do caminho feliz quando `DATABASE_URL` existir. Testes isolados que esperam rejeição de injeção de SQL, troca de id e escalação de papel. Narrador de IA desligado, com teste de funcionamento sem chave.
