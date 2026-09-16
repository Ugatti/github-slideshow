# Timesheet — Azeredo & Ugatti Advogados

Sistema proprietário de controle de horas: lançamento por cliente e projeto,
separação entre conta master e contas de profissional, e relatórios com memória
de cálculo para emissão de nota fiscal de honorários.

A avaliação das alternativas de mercado que levou a este desenvolvimento está em
[`../docs/AVALIACAO-MERCADO.md`](../docs/AVALIACAO-MERCADO.md); as decisões
técnicas, em [`../docs/ARQUITETURA.md`](../docs/ARQUITETURA.md).

## Requisitos

**Node.js 22.5 ou superior** — e nada mais. O sistema não tem dependências de
terceiros: usa `node:sqlite` para o banco, `node:crypto` para senhas e sessões e
`node:http` para o servidor. Não há `npm install`, build, bundler nem
framework, o que elimina a manutenção de árvore de dependências e as
atualizações de segurança que ela arrasta.

## Primeiro uso

```bash
cd timesheet
cp .env.example .env     # opcional: ajuste porta, caminho do banco e conta inicial
npm start
```

Na primeira execução o sistema cria o banco e uma **conta master**, exibindo a
senha uma única vez no terminal:

```
==================================================================
  CONTA MASTER CRIADA
  E-mail: admin@azeredoeugatti.com.br
  Senha : 7kPq2mXvR4wNzL8a
  (senha gerada automaticamente — anote agora e troque no 1º acesso)
==================================================================
```

Acesse `http://localhost:3000`, entre com essas credenciais e troque a senha em
**Conta**. Depois, cadastre clientes, projetos e os profissionais do escritório.

### Avaliar com dados de exemplo

```bash
npm run seed    # cria 5 profissionais, 4 clientes e ~4 meses de lançamentos
npm start
```

Contas de demonstração (senha `Demo123456`): `mariana@exemplo.com.br` e
`leonardo@exemplo.com.br` (master), `carla@`, `rafael@`, `julia@` (profissional).
O seed recusa rodar se o banco já tiver lançamentos.

## Perfis de acesso

| | Profissional (`user`) | Master |
|---|---|---|
| Lançar horas para si | ✓ | ✓ |
| Lançar horas para terceiros | — | ✓ |
| Editar/excluir as próprias horas | ✓ | ✓ |
| Editar/excluir horas de qualquer um | — | ✓ |
| Ver as horas dos colegas | — | ✓ |
| Cadastrar clientes, projetos e usuários | — | ✓ |
| Relatórios | só os próprios | de todo o escritório |
| Memória de cálculo para NF e fechamentos | — | ✓ |
| Trilha de auditoria | — | ✓ |

As restrições são aplicadas **no servidor**. Esconder abas é conveniência de
interface, não mecanismo de segurança: um profissional que chamar a API
diretamente recebe `403`, e um filtro por outro usuário é silenciosamente
reescrito para o próprio.

## Uso diário

**Lançar horas.** Escolha cliente/projeto, informe a duração e descreva a
atividade. A duração aceita `1:30`, `1h30`, `2h`, `1,5` (decimal) e `90` (minutos). Há um cronômetro para medir a atividade em curso e aplicar o tempo
ao campo. Após lançar, data, projeto e profissional são preservados, porque o
padrão de uso é registrar várias atividades seguidas do mesmo caso.

**A descrição vale dinheiro.** Ela compõe a memória de cálculo anexada à nota
fiscal. "Reunião" não sustenta um questionamento do cliente; "Reunião com a
diretoria para definição da estratégia de defesa na reclamatória X" sustenta.

**Fechar o mês.** Em **Nota fiscal**, escolha cliente e período e gere o
demonstrativo — resumido (por projeto e profissional) ou analítico (com todas as
atividades). Imprima em PDF para anexar à NF ou exporte em CSV. Em seguida,
**Fechar período** bloqueia aquelas horas contra edição e exclusão, dando lastro
ao que foi faturado. O fechamento pode ser reaberto, e a reabertura fica
registrada na auditoria.

## Cálculo de valores

O valor/hora é resolvido nesta ordem e **congelado no lançamento**:

1. valor informado explicitamente (só a conta master pode sobrescrever);
2. valor/hora padrão do projeto;
3. valor/hora do profissional;
4. zero — projetos pro bono ou de honorário fixo, em que só as horas importam.

Congelar é deliberado: reajustar a tabela de honorários em março não pode mudar
o relatório de janeiro que já foi faturado.

Valores são armazenados em **centavos** (inteiros) e durações em **minutos**
(inteiros); o arredondamento acontece uma única vez, no fim do cálculo. É o que
evita a divergência de centavos que aparece ao somar valores já arredondados.

## Operação

```bash
npm start      # sobe o servidor (PORT, default 3000)
npm test       # 42 testes (integração + unidade)
npm run seed   # dados de demonstração
```

### Backup

Todo o sistema é um arquivo: `data/timesheet.db`. Com o servidor parado, copiar
esse arquivo é o backup completo. Com o servidor no ar, copie também
`timesheet.db-wal` e `timesheet.db-shm`. **Programe uma cópia diária para fora
do servidor** — é o único ponto de falha que apaga o histórico de faturamento.

### Colocar em produção

O sistema não termina TLS sozinho. Em rede pública, coloque-o atrás de um proxy
HTTPS (nginx, Caddy, Cloudflare Tunnel) e defina:

```bash
SECURE_COOKIES=true
SESSION_SECRET=<48 bytes aleatórios em hex>
```

Gere o segredo com
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Sem `SESSION_SECRET`, o sistema gera um e guarda no banco — funciona, mas
mantê-lo fora do banco é melhor prática.

## Segurança

- Senhas com **scrypt** (N=16384, r=8, p=1) e sal por usuário; nunca em texto claro.
- Sessão em cookie `HttpOnly`, `SameSite=Strict`, com o token guardado no banco
  apenas como HMAC-SHA-256 — vazamento do banco não permite forjar sessões.
- Bloqueio após 8 tentativas de login em 15 minutos, por e-mail.
- Login em tempo constante: e-mail inexistente e senha errada custam o mesmo e
  devolvem a mesma mensagem, para não revelar quem tem conta.
- Troca ou reset de senha e desativação de usuário **encerram todas as sessões**
  daquele usuário.
- Toda saída para HTML é escapada; as consultas usam exclusivamente parâmetros
  ligados (sem concatenação de SQL).
- CSV é exportado com prefixo em campos iniciados por `=`, `+`, `-` ou `@`,
  contra injeção de fórmula em planilha.

### LGPD

O sistema trata dados de profissionais (nome, e-mail, OAB, remuneração por hora)
e de clientes (razão social, CNPJ/CPF, e-mail). Pontos já cobertos:

- acesso segregado por perfil — profissional não vê remuneração nem e-mail de colega;
- trilha de auditoria (princípio da responsabilização, art. 6º, X);
- retenção: registros de horas são preservados por serem base de faturamento;
  usuários são desativados, não apagados, para manter a integridade contábil.

Fica **a cargo do escritório** manter o registro das operações de tratamento, a
política de retenção e o encarregado de dados, se aplicável.

## Estrutura

```
timesheet/
├── server/
│   ├── schema.sql          esquema do banco, comentado
│   ├── db.js               conexão, transações, configurações
│   ├── auth.js             senhas, sessões, bloqueio por tentativas
│   ├── http.js             roteador, parsing, arquivos estáticos, CSRF
│   ├── validate.js         validação e parsing (duração, moeda, CPF/CNPJ)
│   ├── format.js           formatação pt-BR, cálculo de valores, CSV
│   ├── entries-core.js     regras de permissão e filtros dos lançamentos
│   ├── audit.js            trilha de auditoria
│   ├── app.js              montagem do app e bootstrap da conta master
│   └── routes/             auth, users, clients, projects, entries, invoices, reports
├── public/                 interface (index.html, app.js, styles.css)
├── scripts/seed.js         dados de demonstração
└── tests/                  42 testes (api.test.js + unit.test.js)
```
