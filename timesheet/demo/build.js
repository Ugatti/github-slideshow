'use strict';
/**
 * Gera uma versão demonstrativa em arquivo HTML único, para avaliar a
 * interface sem instalar nada. Usa a interface real (public/) somada ao
 * backend simulado (demo/mock-api.js).
 *
 * Uso: npm run demo   →   demo/timesheet-demo.html
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('public/styles.css');
const appJs = read('public/app.js');
const mockJs = read('demo/mock-api.js');
const extrasJs = read('demo/demo-extras.js');
const html = read('public/index.html');

// Só o conteúdo de <body>: a plataforma de publicação fornece o esqueleto.
const corpo = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/<script src="\/app\.js"><\/script>/, '')
  .trim();

// O botão de CSV usa location.href, que um ambiente publicado bloqueia.
const appDemo = appJs.replace(
  /window\.location\.href = (`\/api\/reports\/export\.csv\?[^`]*`);/g,
  'window.__demoExport($1);'
);
const substituicoes = (appJs.match(/window\.location\.href = `\/api\/reports\/export\.csv/g) || []).length;
if (substituicoes !== 2) {
  throw new Error(`Esperava 2 chamadas de exportação CSV para adaptar, encontrei ${substituicoes}.`);
}

const atalhosLogin = `
      <div class="demo-note">
        <strong>Demonstração</strong> — dados fictícios, nada é gravado.
        Recarregar a página reinicia tudo.
      </div>
      <div class="demo-logins">
        <button type="button" class="chip" data-demo-login="mariana@exemplo.com.br">
          Entrar como <strong>master</strong>
        </button>
        <button type="button" class="chip" data-demo-login="carla@exemplo.com.br">
          Entrar como <strong>profissional</strong>
        </button>
      </div>`;

const corpoDemo = corpo.replace(
  '<div class="form-actions">\n      <button type="submit" class="btn btn-primary"',
  `${atalhosLogin}\n      <div class="form-actions">\n      <button type="submit" class="btn btn-primary"`
);
if (corpoDemo === corpo) throw new Error('Não encontrei o ponto de inserção dos atalhos de login.');

const cssDemo = `
/* --- ajustes da versão demonstrativa --- */
.demo-note {
  margin-bottom: 14px; padding: 10px 12px; border-radius: 6px;
  background: var(--gold-soft); border: 1px solid #e8dcc0;
  color: #6b5518; font-size: 12.5px; line-height: 1.45;
}
.demo-logins { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.demo-logins .chip { flex: 1; justify-content: center; text-align: center; padding: 7px 10px; }
.demo-logins .chip strong { font-weight: 600; color: var(--navy-800); }
.demo-ribbon {
  position: fixed; right: 0; bottom: 0; z-index: 80;
  padding: 5px 12px; border-radius: 6px 0 0 0;
  background: var(--navy-900); color: var(--gold-soft);
  font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
}
/* A plataforma acolchoa :root pelas áreas seguras do aparelho; sem isto o
   app de tela cheia estouraria a altura disponível. */
html, body { height: auto; }
.login-screen, .app { min-height: 100dvh; }
@media print { .demo-ribbon { display: none !important; } }
`;

const saida = `<title>Timesheet Azeredo &amp; Ugatti</title>
<style>
${css}
${cssDemo}
</style>

${corpoDemo}

<div class="demo-ribbon">demonstração</div>

<script>
${mockJs}
</script>
<script>
${appDemo}
</script>
<script>
${extrasJs}
</script>
`;

const destino = path.join(__dirname, 'timesheet-demo.html');
fs.writeFileSync(destino, saida);
console.log(`Demonstração gerada: ${path.relative(ROOT, destino)} (${(saida.length / 1024).toFixed(0)} KB)`);
