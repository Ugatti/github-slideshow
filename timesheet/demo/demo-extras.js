'use strict';
/**
 * Ajustes exclusivos da versão demonstrativa, carregados depois de app.js.
 * Nada aqui existe no sistema real.
 */
(function () {
  /* ------------------------------------------------------ exportação de CSV */

  /**
   * No sistema real o botão "Exportar CSV" baixa um arquivo. Numa página
   * publicada o navegador bloqueia downloads iniciados pelo script, então a
   * demonstração monta o mesmo CSV e o exibe, para que o formato possa ser
   * conferido — inclusive o separador ";" que o Excel em português espera.
   */
  window.__demoExport = function (url) {
    const params = Object.fromEntries(new URL(url, location.origin).searchParams.entries());
    const db = window.__demoDb;

    const linhas = db.entries.filter((e) => {
      const projeto = db.projects.find((p) => p.id === e.project_id);
      const cliente = db.clients.find((c) => c.id === projeto.client_id);
      if (params.from && e.work_date < params.from) return false;
      if (params.to && e.work_date > params.to) return false;
      if (params.clientId && cliente.id !== Number(params.clientId)) return false;
      if (params.userId && e.user_id !== Number(params.userId)) return false;
      if (params.billable === 'true' && !e.billable) return false;
      if (params.billable === 'false' && e.billable) return false;
      if (params.invoiced === 'yes' && !e.invoice_id) return false;
      if (params.invoiced === 'no' && e.invoice_id) return false;
      if (params.search && !e.description.toLowerCase().includes(params.search.toLowerCase())) return false;
      return true;
    });

    const cell = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const cabecalho = ['Data', 'Cliente', 'Projeto', 'Código/Processo', 'Profissional', 'Descrição',
      'Horas (h:mm)', 'Horas (decimal)', 'Faturável', 'Valor/hora (R$)', 'Valor (R$)', 'Fechamento'];

    const corpo = linhas.map((e) => {
      const projeto = db.projects.find((p) => p.id === e.project_id);
      const cliente = db.clients.find((c) => c.id === projeto.client_id);
      const usuario = db.users.find((u) => u.id === e.user_id);
      const fechamento = e.invoice_id ? db.invoices.find((i) => i.id === e.invoice_id) : null;
      const valor = e.billable ? Math.round((e.minutes * e.rate_cents) / 60) : 0;
      return [
        dateBr(e.work_date), cliente.name, projeto.name, projeto.code || '', usuario.name,
        e.description, hm(e.minutes), (e.minutes / 60).toFixed(2).replace('.', ','),
        e.billable ? 'Sim' : 'Não', brl(e.rate_cents), brl(valor), fechamento ? fechamento.reference : '',
      ];
    });

    const csv = [cabecalho, ...corpo].map((l) => l.map(cell).join(';')).join('\r\n');
    const previa = csv.split('\r\n').slice(0, 12).join('\n');

    openModal({
      title: `Exportação CSV — ${corpo.length} lançamento(s)`,
      render: (body) => {
        body.innerHTML = `
          <div class="alert info">
            No sistema instalado este botão baixa o arquivo direto.
            Aqui, como a página é publicada num ambiente restrito, mostramos o conteúdo gerado.
          </div>
          <pre style="margin:0;padding:12px;background:#f5f7fa;border:1px solid var(--line);
                      border-radius:6px;overflow:auto;font-size:11.5px;line-height:1.6;
                      max-height:340px;white-space:pre">${esc(previa)}</pre>
          <p class="small muted" style="margin:10px 0 0">
            ${corpo.length > 11 ? `Exibindo as 11 primeiras de ${corpo.length} linhas. ` : ''}
            Separador <code>;</code> e codificação UTF-8 com BOM — abre no Excel com dois cliques.
          </p>`;
      },
      confirmLabel: 'Copiar CSV',
      onConfirm: async () => {
        try {
          await navigator.clipboard.writeText('﻿' + csv);
          toast('CSV copiado para a área de transferência.', 'success');
        } catch {
          toast('Não foi possível copiar automaticamente neste navegador.', 'error');
        }
        return true;
      },
      wide: true,
    });
  };

  /* ----------------------------------------------- preenchimento rápido do login */

  document.querySelectorAll('[data-demo-login]').forEach((botao) => {
    botao.addEventListener('click', () => {
      document.getElementById('login-email').value = botao.dataset.demoLogin;
      document.getElementById('login-password').value = 'Demo123456';
      document.getElementById('login-form').requestSubmit();
    });
  });
})();
