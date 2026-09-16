'use strict';
const db = require('./db');

/** Registra uma ação na trilha de auditoria. Nunca lança: auditoria não pode derrubar a operação. */
function log(actorUserId, action, entity, entityId, details = null) {
  try {
    db.run(
      'INSERT INTO audit_log (at, actor_user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)',
      [new Date().toISOString(), actorUserId ?? null, action, entity, entityId ?? null,
       details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('[auditoria] falha ao registrar', action, entity, err.message);
  }
}

module.exports = { log };
