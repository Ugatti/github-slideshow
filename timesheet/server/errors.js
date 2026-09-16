'use strict';

/** Erro de aplicação com status HTTP — convertido em JSON pelo roteador. */
class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest  = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Autenticação necessária.') => new HttpError(401, msg);
const forbidden   = (msg = 'Você não tem permissão para esta operação.') => new HttpError(403, msg);
const notFound    = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
const conflict    = (msg) => new HttpError(409, msg);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
