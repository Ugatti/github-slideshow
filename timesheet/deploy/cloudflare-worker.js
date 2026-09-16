/**
 * Worker da Cloudflare: serve o timesheet como subpágina do site do escritório.
 *
 *   https://azeredoeugatti.com.br/timesheet/  →  servidor do timesheet
 *   https://azeredoeugatti.com.br/qualquer-outra-coisa  →  site institucional
 *
 * Use este arquivo somente se quiser o sistema dentro do domínio principal.
 * Um subdomínio (timesheet.azeredoeugatti.com.br) dispensa este Worker por
 * completo e não encosta no site — veja docs/IMPLANTACAO.md.
 *
 * Instalação:
 *   1. Cloudflare → Workers & Pages → Create → cole este código.
 *   2. Ajuste as duas constantes abaixo.
 *   3. Em Settings → Domains & Routes, adicione a rota:
 *        azeredoeugatti.com.br/timesheet*
 *      (e também www.azeredoeugatti.com.br/timesheet* se o site usar www).
 *   4. O hostname da rota precisa estar com o proxy ativado (nuvem laranja) no
 *      DNS. Só então o Worker é acionado.
 *
 * No servidor do timesheet, defina:
 *   BASE_PATH=/timesheet
 *   PUBLIC_ORIGIN=https://azeredoeugatti.com.br
 */

/** Caminho público do sistema. Precisa ser igual ao BASE_PATH do servidor. */
const BASE = '/timesheet';

/** Hostname do servidor do timesheet (subdomínio apontando para a VPS). */
const ORIGEM = 'ts-origem.azeredoeugatti.com.br';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Fora do caminho do sistema, nada é tocado: o site segue seu curso.
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) {
      return fetch(request);
    }

    // O caminho vai inteiro para o servidor, que conhece o próprio BASE_PATH.
    const alvo = new URL(url);
    alvo.hostname = ORIGEM;
    alvo.protocol = 'https:';
    alvo.port = '';

    const encaminhada = new Request(alvo, request);
    encaminhada.headers.set('X-Forwarded-Host', url.host);
    encaminhada.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

    // redirect: 'manual' preserva o 308 que o sistema devolve para /timesheet
    // sem barra final — seguir aqui faria o navegador perder o endereço certo.
    const resposta = await fetch(encaminhada, { redirect: 'manual' });

    // Cabeçalhos mutáveis para poder reescrever o Location do redirecionamento.
    const saida = new Response(resposta.body, resposta);
    const location = saida.headers.get('location');
    if (location) {
      try {
        const destino = new URL(location, alvo);
        if (destino.hostname === ORIGEM) {
          destino.hostname = url.hostname;
          destino.protocol = url.protocol;
          saida.headers.set('location', destino.toString());
        }
      } catch {
        // Location relativo (o caso comum aqui): já está correto, segue como veio.
      }
    }
    return saida;
  },
};
