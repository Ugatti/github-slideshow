# Imagem do sistema de timesheet.
# Não há etapa de instalação de dependências: o sistema usa apenas a biblioteca
# padrão do Node, então a imagem é o runtime mais os arquivos do projeto.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# O banco e os backups ficam em volumes; o processo roda sem privilégios.
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TIMESHEET_DB=/app/data/timesheet.db \
    SECURE_COOKIES=true

EXPOSE 3000

# O proxy reverso só deve encaminhar para um processo que responde de fato.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server/index.js"]
