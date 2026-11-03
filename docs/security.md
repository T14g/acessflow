# Segurança

Estas regras valem a partir do primeiro código executável. Nesta fundação ainda não há rotas.

## O que o código de produção faz

- Valida a entrada com Zod na borda.
- Usa SQL parametrizado. O valor do cliente não entra concatenado na sentença.
- Guarda senha com `node:crypto` scrypt. Sem módulo nativo e sem `node-gyp`.
- Entrega a sessão num cookie `httpOnly` e `SameSite=Lax`. O id opaco fica no MySQL.
- Autoriza cada rota pelo papel da aplicação.
- Restringe o CORS à origem do Vite.
- Envia cabeçalhos com `@fastify/helmet`.
- Limita a taxa do login em memória.
- Devolve erro sem stack trace.
- Lê segredos do ambiente. O `.env` permanece fora do Git. O [.env.example](../.env.example) só tem placeholders.

A conta administrativa do MySQL, a mesma usada no HeidiSQL, não aparece em arquivo versionado. A API usa um usuário limitado ao schema `accessflow`.

## O que não entra no produto

- Rota, flag ou seed que deixe uma falha explorável.
- Conexão com diretório, nuvem ou conta real.
- Chamada de rede para IA no caminho normal. `ACCESSFLOW_AI_ENABLED` fica `false`. A suíte de testes não depende de `OPENAI_API_KEY`.
- PostgreSQL, Docker e serviços pagos.

## Testes que nomeiam a falha

Nos incrementos de teste, casos isolados verificam a rejeição de injeção de SQL, troca de id entre pessoas (IDOR) e escalação de papel. O comentário do teste cita a classe da falha. A resposta esperada é a resposta segura. O defeito não existe no código de produção.

Detalhe da decisão em [adr/0006-no-live-vulnerabilities.md](adr/0006-no-live-vulnerabilities.md).
