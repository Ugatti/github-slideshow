# Timesheet — Azeredo & Ugatti Advogados

Sistema proprietário de controle de horas: lançamento por cliente e projeto,
separação entre conta master e contas de profissional, e relatórios com memória
de cálculo para emissão de nota fiscal de honorários.

- [Avaliação das soluções de mercado](../docs/AVALIACAO-MERCADO.md) — por que construir
- [Implantação em nuvem](../docs/IMPLANTACAO.md) — como colocar no ar, com backup
- [Decisões de arquitetura](../docs/ARQUITETURA.md) — por que é assim por dentro

## Ver funcionando sem instalar nada

```bash
npm run demo    # gera demo/timesheet-demo.html
```

Um arquivo HTML único que abre direto no navegador (duplo clique), com a
interface real e um backend simulado em memória — inclusive as regras de
permissão, para que dê para conferir que um profissional não enxerga as horas
dos colegas. Dados fictícios; recarregar reinicia tudo. Serve para avaliar e
para mostrar a sócios antes de instalar.

## Requisitos para uso real

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

> **Se `npm start` reclamar da versão do Node**, atualize para a versão LTS mais
> recente em <https://nodejs.org> e confira com `node --version`. O banco usa o
> módulo `node:sqlite`, que só existe a partir do Node 22.5.

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

**Emitir relatórios.** Em **Relatórios em PDF**, escolha:

- **cliente** — obrigatório;
- **escopo** — todos os projetos do cliente num relatório consolidado, ou
  somente um projeto, para faturar ou prestar contas em separado;
- **período** — qualquer intervalo de datas, com atalhos para os meses recentes;
- **detalhamento** — resumido (por projeto e profissional) ou analítico (com
  todas as atividades descritas).

**Baixar PDF** gera o arquivo com o papel timbrado do escritório. O nome do
arquivo identifica cliente, projeto e período, de modo que os relatórios de
projetos diferentes não se sobrescrevem na pasta. Também há exportação em CSV
e pré-visualização na tela.

**Papel timbrado.** O botão no topo dessa tela abre o cadastro da identidade
visual: nome, CNPJ, endereço, contatos, cores e logotipo (PNG ou JPEG, até
512 KB). É o que aparece no cabeçalho e no rodapé de todo PDF emitido. Como o
cadastro fica no banco, mudar o logotipo não exige alterar código.

**Fechar o mês.** Depois de emitir, **Fechar período** bloqueia aquelas horas
contra edição e exclusão, dando lastro ao que foi faturado. O fechamento pode
ser reaberto, e a reabertura fica registrada na auditoria.

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
npm test       # 59 testes (API, unidade e geração de PDF)
npm run seed   # dados de demonstração no banco
npm run demo   # gera o HTML único de demonstração
npm run backup # instantâneo do banco, com o sistema no ar
```

### Backup

```bash
npm run backup                 # grava em ./backups
npm run backup -- /mnt/nas --keep=60
```

Usa `VACUUM INTO`, que o SQLite executa dentro de uma transação: o arquivo sai
íntegro **com o sistema no ar**. Copiar o `.db` com `cp` durante o uso pode
capturar um estado parcial — por isso o script existe.

**Programe uma cópia diária para fora do servidor.** O histórico de faturamento
é o único dado aqui que não se reconstrói. `deploy/backup-diario.sh` faz o
backup e tem a seção de envio externo (rclone) pronta para descomentar.

### Servir como subpágina de um site

O sistema também roda fora da raiz do domínio — por exemplo em
`azeredoeugatti.com.br/timesheet`, com o site institucional seguindo intacto no
resto do endereço:

```bash
BASE_PATH=/timesheet
PUBLIC_ORIGIN=https://azeredoeugatti.com.br
```

`BASE_PATH` faz o sistema responder apenas sob aquele caminho; `PUBLIC_ORIGIN`
é necessário quando o proxy à frente reescreve o cabeçalho `Host` (um Worker da
Cloudflare, por exemplo), para que a proteção contra CSRF reconheça o endereço
público. `deploy/cloudflare-worker.js` traz o proxy pronto.

O front-end deriva o caminho da própria URL, então o mesmo pacote serve nos dois
modos, sem build separado.

### Colocar em produção

Veja [`../docs/IMPLANTACAO.md`](../docs/IMPLANTACAO.md) — recomendação de
hospedagem, passo a passo e backup. Em resumo: `deploy/` traz `Dockerfile`,
`docker-compose.yml` e `Caddyfile` que sobem o sistema com HTTPS automático, e
`timesheet.service` para quem preferir systemd sem Docker.

O sistema não termina TLS sozinho: em rede pública ele vai **atrás de um proxy
HTTPS**, com `SECURE_COOKIES=true` e um `SESSION_SECRET` fixo. Gere o segredo
com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Sem ele, o sistema gera um e guarda no banco — funciona, mas mantê-lo fora do
banco é melhor prática.

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
│   ├── pdf/                gerador de PDF próprio (document, encoding, image)
│   ├── reports-pdf.js      o relatório timbrado montado sobre o gerador
│   ├── branding.js         identidade visual do escritório
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
├── deploy/                 Docker, Caddy, systemd e backup diário
├── demo/                   empacotador do HTML único + backend simulado
├── scripts/                seed e backup
└── tests/                  59 testes (api, unidade e PDF)
```
