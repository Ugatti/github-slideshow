# Sistema de timesheet — entrega para implantação

Visão geral para quem vai avaliar e colocar o sistema no ar.

---

## 1. O que é

Sistema próprio de controle de horas do escritório: cada profissional lança as
horas por cliente e projeto; a conta master enxerga as horas de todos, administra
os cadastros e emite relatórios em PDF para instruir as notas fiscais de
honorários.

Foi construído sob medida depois de avaliar as soluções de mercado (Projuris,
Legal One/Thomson Reuters, TOTVS, Astrea, CPJ-3C e outras) — o racional dessa
decisão, inclusive em que condições ela deve ser revista, está em
`docs/AVALIACAO-MERCADO.md`.

**Estado atual:** funcional e testado (68 testes automatizados). Nunca foi
colocado em produção. É isso que se está pedindo ajuda para fazer.

---

## 2. A decisão que depende de você

O site do escritório está no **Framer**, com DNS na **Cloudflare** e e-mail no
**Microsoft 365**. O Framer serve páginas prontas da CDN dele e não roda
aplicação — então o sistema precisa de um servidor próprio de qualquer forma.
O que se decide é **como o domínio aponta para ele**:

### Opção A — subdomínio (recomendada)

```
https://timesheet.azeredoeugatti.com.br
```

Um registro A na Cloudflare apontando para a VPS. Não encosta no site: o Framer
continua servindo `azeredoeugatti.com.br` como hoje. Um link no menu do site
("Área do profissional") dá a mesma experiência para quem usa.

### Opção B — subpágina do mesmo endereço

```
https://azeredoeugatti.com.br/timesheet
```

Também já implementada e testada. Exige um Worker da Cloudflare
(`timesheet/deploy/cloudflare-worker.js`, pronto para colar) e as variáveis
`BASE_PATH=/timesheet` e `PUBLIC_ORIGIN=https://azeredoeugatti.com.br`.

**O ponto de atenção:** a rota do Worker só dispara se o hostname do site
estiver com o proxy da Cloudflare ativado (nuvem laranja), e hoje ele está
apenas com DNS. Ativar muda o caminho pelo qual o site institucional é servido
— mexe em algo que está funcionando, para ganhar um endereço mais bonito.

O sistema roda nos dois modos sem build diferente: o front-end deriva o caminho
da própria URL. Oito testes cobrem especificamente o modo subpasta.

**Custo estimado:** R$ 25 a R$ 40 por mês de VPS, fixo, independente do número
de profissionais. Configuração suficiente: 2 GB de RAM, 1 vCPU, 40 GB de disco.

---

## 3. Ver funcionando antes de instalar nada

```bash
cd timesheet && npm run demo
```

Gera `timesheet/demo/timesheet-demo.html`: abra no navegador (duplo clique).
É a interface real com um backend simulado em memória, inclusive as regras de
permissão — dá para entrar como master e como profissional e conferir que um
não enxerga as horas do outro. Dados fictícios; recarregar reinicia.

---

## 4. Rodar de verdade, localmente

**Requisito único: Node.js 22.5 ou superior.** Não há dependências de
terceiros — nem `npm install`, nem build, nem framework. O sistema usa só a
biblioteca padrão do Node (`node:sqlite`, `node:crypto`, `node:http`). Essa foi
uma decisão consciente, explicada em `docs/ARQUITETURA.md`: um sistema interno
de escritório tem vida longa e manutenção esporádica, e árvore de dependências
é o que costuma matar esse tipo de software dois anos depois.

```bash
cd timesheet
npm run seed     # opcional: ~4 meses de lançamentos fictícios
npm start        # http://localhost:3000
npm test         # 68 testes
```

No primeiro boot o sistema cria a conta master e imprime a senha **uma única
vez** no terminal.

---

## 5. Implantação

O passo a passo completo está em `docs/IMPLANTACAO.md`. Resumo:

```bash
cd timesheet/deploy
cp .env.example .env    # preencher DOMAIN, SESSION_SECRET, e-mail da conta master
docker compose up -d
```

O `docker-compose.yml` sobe a aplicação e um Caddy que obtém e renova o
certificado HTTPS sozinho. Há também `timesheet.service` (systemd) para quem
preferir sem Docker.

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `SESSION_SECRET` | Assina as sessões. Gere uma vez e não troque (trocar derruba todas as sessões). |
| `SECURE_COOKIES` | `true` atrás de HTTPS. |
| `BOOTSTRAP_MASTER_EMAIL` | Conta master criada no primeiro boot. |
| `BOOTSTRAP_MASTER_PASSWORD` | Deixe vazio para o sistema gerar e imprimir no log. |
| `BASE_PATH` | Só na Opção B: `/timesheet`. |
| `PUBLIC_ORIGIN` | Só na Opção B: o endereço público, porque o Worker reescreve o `Host` e sem isso a proteção contra CSRF barra as próprias telas. |
| `TIMESHEET_DB` | Caminho do banco. No Docker já aponta para o volume. |

### Backup — a parte que não dá para pular

Todo o histórico de faturamento é um arquivo SQLite. Perdê-lo é perder a base
das notas fiscais já emitidas; é o único dado aqui que não se reconstrói.

```bash
npm run backup                      # ./backups
npm run backup -- /mnt/nas --keep=60
```

Usa `VACUUM INTO`, que gera um instantâneo íntegro **com o sistema no ar** —
`cp` durante o uso pode capturar estado parcial. `deploy/backup-diario.sh` está
pronto para o cron e tem a seção de envio externo (rclone) comentada.

**Um backup no mesmo servidor não protege contra a perda do servidor.**
Configure o destino externo e teste a restauração ao menos uma vez.

---

## 6. Segurança

- Senhas com **scrypt** (N=16384) e sal por usuário.
- Sessão em cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção; no banco
  guarda-se apenas o HMAC-SHA-256 do token, então vazar o banco não permite
  forjar sessões.
- Bloqueio após 8 tentativas de login em 15 minutos; login em tempo constante
  (e-mail inexistente custa o mesmo que senha errada).
- Troca/reset de senha e desativação de usuário encerram todas as sessões
  daquele usuário.
- Toda saída para HTML é escapada; SQL só com parâmetros ligados.
- Proteção contra CSRF por `SameSite=Strict` mais verificação de origem.
- Trilha de auditoria de quem criou, alterou e excluiu — guardando inclusive o
  conteúdo do que foi apagado.

O sistema **não termina TLS sozinho**: vai sempre atrás de um proxy HTTPS.

---

## 7. Mapa dos arquivos

```
timesheet/
├── server/              backend (sem dependências externas)
│   ├── schema.sql       esquema do banco, comentado
│   ├── pdf/             gerador de PDF próprio
│   ├── routes/          auth, users, clients, projects, entries, invoices, reports, settings
│   └── entries-core.js  regras de permissão dos lançamentos
├── public/              interface (3 arquivos: html, css, js)
├── deploy/              Docker, Caddy, systemd, Worker da Cloudflare, backup
├── demo/                empacotador da demonstração em arquivo único
├── scripts/             seed e backup
└── tests/               68 testes
docs/
├── AVALIACAO-MERCADO.md por que construir em vez de comprar
├── ARQUITETURA.md       decisões técnicas e o porquê de cada uma
├── IMPLANTACAO.md       passo a passo da implantação
└── ENTREGA-TI.md        este documento
```

---

## 9. Pendências

1. **Escolher entre a Opção A e a Opção B** (seção 2).
2. **Escolher o provedor de VPS** — a recomendação é uma VPS brasileira
   (Magalu Cloud, Hostinger, KingHost, Locaweb), por nota fiscal em reais,
   suporte em português e dados no Brasil.
3. **Configurar o backup externo** antes de o sistema entrar em uso real.
4. **Cadastrar a identidade visual** — no sistema, em *Relatórios em PDF →
   Papel timbrado*: logotipo, CNPJ, endereço e cores que aparecem no cabeçalho
   dos relatórios. Hoje está com valores de exemplo.
