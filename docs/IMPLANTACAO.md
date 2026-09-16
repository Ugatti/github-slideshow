# Implantação em nuvem

Objetivo: cada profissional lança horas de onde estiver (escritório, casa,
fórum, celular) e a conta master baixa os relatórios à distância.

---

## Recomendação

**Uma VPS brasileira + Docker Compose com HTTPS automático.**
Custo aproximado: **R$ 25 a R$ 40 por mês**, valor fixo, independente do número
de profissionais.

Por que essa, entre as alternativas avaliadas:

| Critério | VPS brasileira (recomendada) | Fly.io (região GRU) | Nuvem grande (AWS/Azure) |
|---|---|---|---|
| Custo mensal | ~R$ 25–40, fixo | ~US$ 5–12 + volume a US$ 0,15/GB | Maior; cobrança por componente |
| Pagamento | Real, nota fiscal brasileira | Cartão internacional, em dólar | Cartão internacional |
| Suporte | Português | Inglês, por ticket | Inglês/pago |
| Dados fisicamente no Brasil | Sim | Sim (região GRU) | Sim (região São Paulo) |
| Operação | SSH + um comando | CLI própria | Complexa para este porte |

Para um sistema com meia dúzia de usuários e um banco que cabe num arquivo, a
nuvem grande é desproporcional — paga-se a complexidade sem usar nada dela. O
Fly.io é uma boa alternativa técnica, mas cobra em dólar e o suporte é em
inglês, o que costuma pesar num escritório de advocacia. A VPS brasileira
resolve com nota fiscal em reais e suporte em português.

Provedores com data center em São Paulo e imagem pronta de Docker:
**Magalu Cloud**, **Hostinger**, **KingHost**, **Locaweb**, **HostGator**.
Configuração suficiente: **2 GB de RAM, 1 vCPU, 40 GB de disco** — com folga.

> **Sobre LGPD.** Manter os dados no Brasil não é exigência legal (a LGPD
> admite transferência internacional sob condições), mas simplifica a
> documentação e elimina a discussão. Como o sistema trata dados de clientes do
> escritório, é o caminho de menor atrito.

---

## Passo a passo

### 1. Domínio

Crie um subdomínio apontando para o IP da VPS — por exemplo
`timesheet.azeredoeugatti.com.br` — com um **registro A** no painel de DNS do
domínio do escritório. Espere a propagação (minutos a poucas horas).

### 2. Servidor

Contrate a VPS com **Ubuntu 24.04**. Conecte por SSH e instale o Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Abra apenas as portas necessárias:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 3. Sistema

```bash
git clone https://github.com/Ugatti/github-slideshow.git /opt/timesheet-repo
cd /opt/timesheet-repo/timesheet/deploy
cp .env.example .env
```

Edite o `.env`:

```bash
nano .env
```

Preencha `DOMAIN`, `BOOTSTRAP_MASTER_EMAIL` e gere o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Suba:

```bash
docker compose up -d
```

O Caddy obtém o certificado HTTPS sozinho (Let's Encrypt) e o renova. Em um ou
dois minutos o sistema responde em `https://timesheet.azeredoeugatti.com.br`.

### 4. Primeiro acesso

A senha da conta master é gerada e impressa uma única vez:

```bash
docker compose logs app | grep -A4 "CONTA MASTER"
```

Entre, **troque a senha** em *Conta*, e cadastre clientes, projetos e os
profissionais do escritório. Depois, em *Relatórios em PDF → Papel timbrado*,
envie o logotipo e preencha os dados que aparecem no cabeçalho dos relatórios.

### 5. Backup — não pule esta etapa

O histórico inteiro de faturamento é um arquivo. Perdê-lo é perder a base das
notas fiscais emitidas.

```bash
crontab -e
```

Acrescente:

```
0 2 * * * /opt/timesheet-repo/timesheet/deploy/backup-diario.sh >> /var/log/timesheet-backup.log 2>&1
```

O script usa `VACUUM INTO`, que gera um instantâneo íntegro **com o sistema no
ar** — copiar o arquivo com `cp` durante o uso pode capturar um estado parcial.
Mantém as 30 cópias mais recentes.

**Um backup no mesmo servidor não protege contra a perda do servidor.**
Descomente a seção `rclone` do script e configure um destino externo (Google
Drive do escritório, S3, Backblaze). Cinco minutos de configuração que evitam
a única perda irreversível deste sistema.

Teste a restauração pelo menos uma vez: copie um backup para outra máquina,
aponte `TIMESHEET_DB` para ele e confira se os lançamentos estão lá. Backup não
testado não é backup.

### 6. Atualizações

```bash
cd /opt/timesheet-repo && git pull
cd timesheet/deploy && docker compose up -d --build
```

O banco fica em volume Docker separado da imagem — atualizar não toca nos dados.

---

## Alternativa sem Docker

Para quem prefere rodar direto no servidor: instale o Node.js 22 LTS, copie o
projeto para `/opt/timesheet`, crie o usuário `timesheet`, use o arquivo
`deploy/timesheet.service` (systemd) e coloque nginx ou Caddy à frente para o
HTTPS. O serviço já vem com restrições de escrita configuradas.

---

## O que fica sob responsabilidade do escritório

- **Backup externo funcionando** — verificar de tempos em tempos que os
  arquivos estão chegando ao destino.
- **Atualizações do sistema operacional** — `apt update && apt upgrade`
  mensalmente, ou `unattended-upgrades` ativado.
- **Contas de acesso** — desativar quem sai do escritório, no mesmo dia.
- **Renovação do domínio e da VPS** — deixar em débito automático evita que o
  sistema caia por esquecimento de pagamento.

## Fontes de preço consultadas

- [Comparativo de VPS no Brasil (2026)](https://audaks.com.br/blog/melhores-vps-brasil-2026-comparativo-honesto)
- [Ranking de VPS brasileiras](https://tudosobrehospedagemdesites.com.br/melhor-vps/)
- [Preços de recursos do Fly.io](https://fly.io/docs/about/pricing/)
