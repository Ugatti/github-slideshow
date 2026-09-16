'use strict';
const branding = require('../branding');
const audit = require('../audit');
const v = require('../validate');
const { badRequest } = require('../errors');
const { send } = require('../http');
const { parse: parseImage } = require('../pdf/image');

const LOGO_MAX_BYTES = 512 * 1024;
const COR = /^#[0-9a-fA-F]{6}$/;

function cor(valor, campo, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const v2 = String(valor).trim();
  if (!COR.test(v2)) throw badRequest(`"${campo}" deve ser uma cor em hexadecimal, como #0f2033.`);
  return v2.toLowerCase();
}

module.exports = function register(router) {
  /** Todos leem: a interface usa o nome e as cores do escritório no cabeçalho. */
  router.get('/api/settings/branding', async () => ({ branding: branding.get() }));

  router.put('/api/settings/branding', async (ctx) => {
    const atual = branding.get();
    const valores = {
      name: v.str(ctx.body.name, 'nome do escritório', { max: 150 }),
      tagline: v.str(ctx.body.tagline, 'subtítulo', { required: false, max: 80 }) || '',
      cnpj: ctx.body.cnpj ? v.document(ctx.body.cnpj, 'CNPJ do escritório') : '',
      address: v.str(ctx.body.address, 'endereço', { required: false, max: 200 }) || '',
      phone: v.str(ctx.body.phone, 'telefone', { required: false, max: 60 }) || '',
      email: ctx.body.email ? v.email(ctx.body.email, 'e-mail') : '',
      site: v.str(ctx.body.site, 'site', { required: false, max: 120 }) || '',
      primaryColor: cor(ctx.body.primaryColor, 'cor principal', atual.primaryColor),
      accentColor: cor(ctx.body.accentColor, 'cor de destaque', atual.accentColor),
      footerNote: v.str(ctx.body.footerNote, 'nota de rodapé', { required: false, max: 200 }) || '',
    };
    const salvo = branding.save(valores);
    audit.log(ctx.user.id, 'update', 'branding', null, { name: salvo.name });
    return { branding: salvo };
  }, { role: 'master' });

  /** Recebe o logotipo como data URL (data:image/png;base64,...). */
  router.post('/api/settings/logo', async (ctx) => {
    const dataUrl = v.str(ctx.body.dataUrl, 'arquivo', { max: 1_400_000 });
    const m = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/i.exec(dataUrl);
    if (!m) throw badRequest('Envie um arquivo PNG ou JPEG.');

    const buffer = Buffer.from(m[3], 'base64');
    if (!buffer.length) throw badRequest('Arquivo vazio.');
    if (buffer.length > LOGO_MAX_BYTES) {
      throw badRequest(`O logotipo deve ter no máximo ${LOGO_MAX_BYTES / 1024} KB.`);
    }

    // Valida agora: um logotipo que o gerador de PDF não entende precisa ser
    // recusado no envio, não na hora de emitir o relatório para o cliente.
    let info;
    try {
      info = parseImage(buffer);
    } catch (err) {
      throw badRequest(`Não foi possível ler a imagem: ${err.message}`);
    }
    if (info.width < 40 || info.height < 20) {
      throw badRequest('A imagem é pequena demais para servir de logotipo.');
    }

    branding.saveLogo(buffer);
    audit.log(ctx.user.id, 'update', 'branding_logo', null, {
      bytes: buffer.length, width: info.width, height: info.height,
    });
    return { ok: true, width: info.width, height: info.height };
  }, { role: 'master' });

  router.delete('/api/settings/logo', async (ctx) => {
    branding.clearLogo();
    audit.log(ctx.user.id, 'delete', 'branding_logo', null);
    return { ok: true };
  }, { role: 'master' });

  /** Devolve o logotipo para pré-visualização na tela de configurações. */
  router.get('/api/settings/logo', async (ctx) => {
    const buffer = branding.logo();
    if (!buffer) return { logo: null };
    const tipo = buffer[0] === 0xff ? 'image/jpeg' : 'image/png';
    send(ctx.res, 200, buffer, {
      'Content-Type': tipo,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    });
  });
};
