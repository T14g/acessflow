# ADR 0006: Sem vulnerabilidade ativa

- Status: aceito
- Data: 2026-11-03

## Contexto

Falhas comuns de segurança ficam documentadas nos testes. Uma rota quebrada de propósito, mesmo com flag, continua sendo uma falha explorável se alguém subir o projeto.

## Decisão

Não há rota, flag nem seed vulnerável. Injeção de SQL, IDOR e escalação de papel aparecem só em testes. O teste envia a entrada maliciosa e espera a resposta segura. O comentário nomeia a classe da falha. O código de produção não contém o defeito.

Segredos não são commitados. Erros de API não devolvem stack.

## Consequências

Quem clonar o repositório não encontra um endpoint inseguro para demonstração. A evidência fica na suíte de testes, na etapa de fechamento.
