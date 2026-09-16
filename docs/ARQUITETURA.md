# Decisões de arquitetura — Timesheet

Registro das escolhas técnicas e do porquê de cada uma. Serve para quem for
manter o sistema daqui a dois anos — provavelmente sem lembrar do contexto.

## Zero dependências de terceiros

O sistema usa apenas a biblioteca padrão do Node.js 22: `node:sqlite` (banco),
`node:crypto` (scrypt, HMAC, aleatoriedade), `node:http` (servidor). Não há
Express, ORM, bundler ou framework de frontend.

**Por quê.** Um sistema interno de escritório de advocacia tem vida longa e
manutenção esporádica. Cada dependência é uma dívida: atualizações de
segurança, breaking changes, abandono de projeto. Um `npm audit` com trinta
alertas dois anos depois é o que mata software interno — ninguém quer mexer.
Sem dependências, o sistema só depende do runtime, e atualizar o Node é uma
operação simples.

**O que se perde.** Ergonomia. O roteador, a validação e a renderização são
feitos à mão. O código é mais longo do que seria com bibliotecas — cerca de
2.600 linhas no total, ainda perfeitamente legível por uma pessoa em uma tarde.

**Limite.** `node:sqlite` é marcado como experimental no Node 22 e emite aviso
na inicialização. A API usada (`DatabaseSync`, `prepare`, `run`, `all`, `get`)
é mínima e estável; se mudar, a superfície a corrigir está inteira em
`server/db.js`.

## SQLite, não PostgreSQL

Um escritório de médio porte gera na ordem de dezenas de milhares de
lançamentos por ano. SQLite atende com folga, e o banco inteiro é um arquivo —
backup é `cp`, restauração é `cp` de volta. Sem servidor de banco, sem
usuários, sem porta aberta, sem tuning.

**Quando migrar.** Se houver necessidade de acesso concorrente de escrita
elevado ou de replicação. Não é o caso previsível aqui. O SQL usado é
padrão o suficiente para que a migração, se vier, seja localizada.

## Inteiros para dinheiro e tempo

Valores em **centavos**, durações em **minutos**, ambos inteiros. Nunca
`float`.

O arredondamento acontece **uma única vez**, no fim: o valor de um lançamento é
`round(minutos × valor_hora_em_centavos / 60)`. Somar valores já arredondados
produz divergência de centavos ao longo de um mês — e divergência de centavos
em nota fiscal gera pergunta de cliente.

## Congelamento do valor/hora

`time_entries.rate_cents` guarda o valor/hora **vigente no momento do
lançamento**, resolvido por precedência: explícito (só master) → projeto →
profissional → zero.

Sem isso, reajustar a tabela de honorários reescreveria retroativamente todos
os relatórios já emitidos. O sistema seria incapaz de reproduzir o número que
foi efetivamente faturado — inaceitável para a finalidade contábil.

O efeito colateral é intencional: corrigir um valor/hora lançado errado exige
ação explícita da conta master sobre o lançamento.

## Fechamento de período

A tabela `invoices` representa o fechamento que lastreia uma nota fiscal.
Lançamentos vinculados a um fechamento não cancelado ficam bloqueados contra
edição e exclusão — para todos os perfis, master inclusive.

**Por que travar a master também.** O risco não é má-fé, é engano: alterar em
outubro uma hora já faturada em setembro faz o relatório emitido deixar de
bater com o banco. Reabrir o fechamento é um ato consciente e auditado, e essa
fricção é o ponto.

## Permissões no servidor

A regra central está em `entries-core.js:loadEntryForWrite` e
`entries-core.js:buildFilter`:

- escrita: `role !== 'master' && row.user_id !== actor.id` → `403`;
- leitura: um profissional tem `te.user_id = ?` forçado no `WHERE`, com o
  próprio id, **antes** de qualquer filtro da requisição.

Filtrar por outro usuário não dá erro — é silenciosamente reescrito para o
próprio. Isso evita transformar a mensagem de erro em oráculo sobre quem
existe no sistema.

A interface esconde abas por perfil, mas isso é conveniência. O teste
`filtrar por outro usuário não vaza dados para o profissional` existe
exatamente para garantir que a interface não seja a única barreira.

## Sessões

Token aleatório de 32 bytes em cookie `HttpOnly`, `SameSite=Strict`. No banco
guarda-se apenas o **HMAC-SHA-256** do token: quem obtiver uma cópia do arquivo
do banco não consegue forjar sessão.

A proteção contra CSRF é dupla: `SameSite=Strict` no cookie e verificação de
`Origin` nas mutações. Não há token CSRF em formulário porque não há formulário
HTML clássico — tudo é `fetch` de mesma origem.

Trocar senha, resetar senha ou desativar usuário **apagam todas as sessões**
daquele usuário. Um acesso comprometido precisa ser encerrável de fato.

## Arquivar em vez de apagar

Clientes, projetos e usuários com horas lançadas são desativados
(`active = 0`), nunca removidos. As chaves estrangeiras são `RESTRICT`, o que
transforma uma tentativa de exclusão indevida em erro, não em perda de dados.

Cadastros que nunca tiveram lançamento são apagados de verdade — corrigir um
cadastro criado por engano não deve deixar lixo permanente.

## Trilha de auditoria

`audit_log` registra criação, alteração e exclusão, com o **conteúdo do
lançamento excluído** guardado em JSON. Quando um cliente questiona uma hora
faturada, a pergunta é "quem lançou isso, e quando foi alterado?" — e a
resposta precisa existir mesmo que o lançamento tenha sido apagado.

`audit.log()` nunca lança exceção: falha de auditoria não pode derrubar a
operação em curso, apenas registrar no log do servidor.

## CSV com `;` e BOM

O separador é ponto-e-vírgula e o arquivo começa com BOM UTF-8. É a combinação
que o Excel em português abre com dois cliques, com acentuação correta, sem
passar pelo assistente de importação. Vírgula e UTF-8 sem BOM produzem uma
coluna única com acentos quebrados — e alguém vai reclamar disso todo mês.

Campos iniciados por `=`, `+`, `-` ou `@` recebem prefixo `'`, contra injeção
de fórmula.

## Frontend em uma página

`public/app.js` é uma SPA de arquivo único, sem framework, com renderização por
template string e escape explícito (`esc()`) em toda interpolação de dado.

**Por quê.** O mesmo raciocínio das dependências do servidor: um build de
frontend é uma peça que precisa de manutenção. Aqui, editar o arquivo e
recarregar a página é o ciclo completo de desenvolvimento.

**O risco assumido** é XSS por esquecimento de `esc()`. A mitigação é que todo
dado vindo do servidor passa por `esc()` sem exceção, e o código é curto o
bastante para auditar.

## Impressão como funcionalidade

O demonstrativo para nota fiscal é gerado pelo `@media print` do CSS, não por
biblioteca de PDF. "Imprimir / PDF" usa o diálogo do navegador. Uma dependência
a menos, e o resultado é um PDF com texto selecionável e pesquisável, não uma
imagem.

## Testes

42 testes, com o peso deliberadamente concentrado na integração: 33 em
`tests/api.test.js` rodam contra um servidor HTTP real, com banco temporário e
sessões distintas por perfil; 9 em `tests/unit.test.js` cobrem os parsers e a
aritmética de valores.

**Por que essa proporção.** O que pode dar errado aqui não é sobretudo a
aritmética — é a permissão. Um teste de unidade de `resolveRateCents` não pega
um `WHERE` mal montado que deixa o estagiário ver a hora do sócio. Os testes de
API exercitam o sistema pela borda, que é exatamente onde esse erro apareceria.
A unidade fica para o que tem muitos casos-limite e nenhum estado: parsing de
duração e de moeda, arredondamento e geração de CSV.

O teste de corpo excessivo já pagou por si: revelou que o servidor derrubava a
conexão ao estourar o limite, fazendo o cliente ver "falha de rede" em vez do
`413` com a explicação.
