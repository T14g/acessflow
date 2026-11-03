# ADR 0002: Somente MySQL 8.3

- Status: aceito
- Data: 2026-11-03

## Contexto

O notebook já tem MySQL Server 8.3 em `127.0.0.1:3306`, usado pelo HeidiSQL. PostgreSQL não está instalado. Manter dois motores aumentaria disco, memória e o SQL a sustentar. O projeto precisa de banco relacional e transação, não de um motor específico.

## Decisão

O único banco do AccessFlow é o MySQL 8.3 local, via `mysql2`, banco `accessflow`, tabelas InnoDB.

PostgreSQL não entra como driver, migração, teste, Docker ou caminho opcional. SQLite também fica de fora nesta versão e só seria reconsiderado se este MySQL deixar de estar utilizável.

Ids são `CHAR(36)` gerados na aplicação. Payload de evento usa coluna `JSON`. Datas usam `DATETIME(3)` em UTC. A reserva do outbox usa `SELECT ... FOR UPDATE SKIP LOCKED`.

A API não usa a conta administrativa do HeidiSQL. Um usuário limitado ao schema `accessflow` terá a senha apenas no `.env` local.

## Consequências

Há um dialeto só. O padrão de outbox continua válido no InnoDB. O README explica a escolha.
