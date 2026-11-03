# Domínio

A Helios Indústria é uma empresa fictícia. Pessoas, sistemas, perfis e concessões existem só neste MySQL local.

Os campos e as chaves estão em [data-model.md](data-model.md). As rotas estão em [api.md](api.md).

## Módulos

- **Autenticação de demonstração.** E-mail e senha fictícios, hash scrypt, sessão opaca no MySQL. É adequada para este laboratório local. Não é um desenho de produção: não há MFA, recuperação de senha nem provedor externo.
- **Usuários e papéis.** Uma pessoa tem um papel na aplicação.
- **Catálogo.** Sistemas e perfis. O perfil pode ser privilegiado e pode entrar num par de segregação de funções.
- **Solicitações.** O colaborador pede um perfil para si, com justificativa e prazo opcional.
- **Aprovações.** Gestor ou administrador aprova ou recusa. Recusa exige justificativa. Ninguém aprova o próprio pedido.
- **Concessões.** Depois do conector, o acesso fica `active`, e mais tarde `expired` ou `revoked`.
- **Provisionamento simulado.** Escreve no diretório fictício (`directory_accounts`, `directory_memberships`).
- **Alertas de risco.** O AccessGuard gera a nota, a recomendação e os alertas. Não concede acesso.
- **Auditoria.** Cada ação relevante vira uma linha append-only.

## Papéis

São papéis do AccessFlow, diferentes dos perfis dos sistemas da Helios.

| Papel | Pode |
| --- | --- |
| `employee` | Entrar, ver o catálogo, pedir acesso para si, ver as próprias solicitações e concessões |
| `manager` | O que o colaborador pode, mais ver e decidir solicitações dos subordinados e revogar essas concessões |
| `admin` | Ver tudo, pedir para outro beneficiário, decidir solicitações, revogar, listar usuários |
| `security_analyst` | Ler catálogo, solicitações, concessões, alertas e auditoria. Não aprova, não revoga e não administra usuários |

O analista existe porque alertas e auditoria precisam de um leitor que não seja administrador. Sem esse papel, a leitura de risco ficaria só com quem também altera acessos.

## Solicitação

Estados: `submitted`, `pending_approval`, `rejected`, `approved`, `provisioning`, `provisioned`, `failed`.

O AccessGuard, no worker, pode recusar (`deny`) ou mandar para a fila (`require_approval`, `allow_with_approval`). Privilegiado sempre passa por pessoa. Regras:

- conflito de segregação de funções;
- perfil privilegiado;
- concessão já ativa para o mesmo beneficiário e perfil;
- beneficiário diferente do solicitante.

## Concessão

Estados: `active`, `expired`, `revoked`. Falha de provisionamento não cria concessão ativa; a solicitação fica `failed`.
