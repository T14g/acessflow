# ADR 0004: AccessGuard determinístico

- Status: aceito
- Data: 2026-11-03

## Contexto

O módulo de risco precisa funcionar offline, sem chave de API e com resultado repetível em teste. Uma chamada de IA no caminho da decisão tornaria o projeto dependente de um serviço pago.

## Decisão

O AccessGuard aplica regras locais: conflito de SoD, entitlement privilegiado, acesso já existente e solicitante diferente do beneficiário em acesso privilegiado. A saída é uma nota de 0 a 100 e uma recomendação (`require_approval`, `deny` ou `allow_with_approval`).

Entitlement privilegiado nunca é auto-provisionado. O motor não chama o conector.

`ACCESSFLOW_AI_ENABLED` fica `false`. Se um adaptador OpenAI existir no futuro, ele só redige texto sobre a avaliação já gravada. Sem chave, o narrador local fixo continua valendo. Os testes não chamam a rede.

## Consequências

A mesma solicitação produz a mesma avaliação. O produto funciona sem OpenAI.
