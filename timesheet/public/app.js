'use strict';
/* Azeredo & Ugatti Advogados — Timesheet (SPA sem dependências) */

/* ===================================================================== API */

async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return {};
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(payload?.error || `Falha na requisição (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return payload;
}
const API = {
  get: (p) => api('GET', p),
  post: (p, b) => api('POST', p, b ?? {}),
  put: (p, b) => api('PUT', p, b ?? {}),
  patch: (p, b) => api('PATCH', p, b ?? {}),
  del: (p) => api('DELETE', p),
};

/* =================================================================== estado */

const state = {
  user: null,
  firm: null,
  view: 'lancar',
  clients: [],
  projects: [],
  users: [],
  filters: {},        // filtros por view
  lastReport: null,
};

const isMaster = () => state.user?.role === 'master';

/**
 * Cada navegação recebe um número. Uma resposta que chega depois de o usuário
 * já ter trocado de aba não pode escrever na tela nova — sem esta guarda, a
 * requisição lenta da aba anterior encontra um DOM que não é mais o seu e
 * derruba a tela que acabou de abrir.
 */
let navToken = 0;
const stillCurrent = (nav) => nav === navToken;

/* ================================================================ formatação */

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const hm = (minutes) => {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes || 0);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
};
const dec = (minutes) => ((minutes || 0) / 60).toFixed(2).replace('.', ',');
const brl = (cents) =>
  ((cents || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brlFull = (cents) => `R$ ${brl(cents)}`;
const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const dateTimeBr = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}
const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

const BILLING_LABEL = { hourly: 'Por hora', fixed: 'Honorário fixo', pro_bono: 'Pro bono' };
const INVOICE_STATUS = {
  closed:    { label: 'Fechado',   cls: 'warn' },
  invoiced:  { label: 'Faturado',  cls: 'ok' },
  cancelled: { label: 'Cancelado', cls: 'danger' },
};

/* ============================================================ notificações */

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, kind === 'error' ? 6000 : 3400);
}

/* ==================================================================== modal */

/** Abre um modal. `render` recebe o elemento .body; `onConfirm` fecha se retornar true. */
function openModal({ title, render, confirmLabel = 'Salvar', onConfirm, wide = false }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:820px"' : ''}>
      <header><h3>${esc(title)}</h3>
        <button class="btn btn-sm" data-close type="button" aria-label="Fechar">✕</button></header>
      <div class="body"></div>
      <footer>
        <button class="btn" data-close type="button">Cancelar</button>
        <button class="btn btn-primary" data-confirm type="button">${esc(confirmLabel)}</button>
      </footer>
    </div>`;

  const body = backdrop.querySelector('.body');
  render(body);

  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  const confirmBtn = backdrop.querySelector('[data-confirm]');
  if (!onConfirm) confirmBtn.remove();
  else {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        if (await onConfirm(body)) close();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        confirmBtn.disabled = false;
      }
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') confirmBtn.click();
    });
  }
  root.append(backdrop);
  setTimeout(() => backdrop.querySelector('input,select,textarea')?.focus(), 30);
  return close;
}

function confirmDialog(title, message, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    let decided = false;
    openModal({
      title,
      render: (body) => { body.innerHTML = `<p style="margin:0">${message}</p>`; },
      confirmLabel,
      onConfirm: () => { decided = true; resolve(true); return true; },
    });
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal-backdrop') && !decided) { observer.disconnect(); resolve(false); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/* ============================================ componentes reaproveitados */

function projectOptions(selectedId = '') {
  const byClient = new Map();
  for (const p of state.projects) {
    if (!byClient.has(p.clientName)) byClient.set(p.clientName, []);
    byClient.get(p.clientName).push(p);
  }
  return [...byClient.entries()]
    .map(([client, list]) => `
      <optgroup label="${esc(client)}">
        ${list.map((p) => `
          <option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>
            ${esc(p.name)}${p.code ? ` · ${esc(p.code)}` : ''}
          </option>`).join('')}
      </optgroup>`)
    .join('');
}

const clientOptions = (selectedId = '', { includeAll = false } = {}) =>
  (includeAll ? '<option value="">Todos os clientes</option>' : '') +
  state.clients.map((c) =>
    `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');

const userOptions = (selectedId = '', { includeAll = false, allLabel = 'Todos os profissionais' } = {}) =>
  (includeAll ? `<option value="">${esc(allLabel)}</option>` : '') +
  state.users.filter((u) => u.active !== false).map((u) =>
    `<option value="${u.id}" ${String(u.id) === String(selectedId) ? 'selected' : ''}>${esc(u.name)}</option>`
  ).join('');

/** Linha de totais reutilizada em todas as listagens. */
function statsRow(totals, { showMoney = true } = {}) {
  const billable = totals.billableMinutes ?? 0;
  const pct = totals.minutes ? Math.round((billable / totals.minutes) * 100) : 0;
  return `
    <div class="stats">
      <div class="stat">
        <div class="label">Horas no período</div>
        <div class="value">${hm(totals.minutes)}</div>
        <div class="hint">${dec(totals.minutes)} h decimais · ${totals.entries ?? totals.count ?? 0} lançamentos</div>
      </div>
      <div class="stat">
        <div class="label">Horas faturáveis</div>
        <div class="value">${hm(billable)}</div>
        <div class="hint">${pct}% do total</div>
      </div>
      ${showMoney ? `
      <div class="stat">
        <div class="label">Valor a faturar</div>
        <div class="value money">${brlFull(totals.valueCents)}</div>
        <div class="hint">horas faturáveis × valor/hora</div>
      </div>` : ''}
      ${totals.professionals !== undefined ? `
      <div class="stat">
        <div class="label">Profissionais</div>
        <div class="value">${totals.professionals}</div>
        <div class="hint">${totals.clients ?? 0} cliente(s) atendido(s)</div>
      </div>` : ''}
    </div>`;
}

/** Tabela de lançamentos, com ações condicionadas à permissão do usuário. */
function entriesTable(entries, { showUser = false, showActions = true } = {}) {
  if (!entries.length) {
    return `<div class="empty">Nenhum lançamento encontrado para os filtros selecionados.</div>`;
  }
  const totalMin = entries.reduce((s, e) => s + e.minutes, 0);
  const totalVal = entries.reduce((s, e) => s + e.valueCents, 0);

  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Data</th>
          ${showUser ? '<th>Profissional</th>' : ''}
          <th>Cliente / Projeto</th>
          <th>Atividade</th>
          <th class="num">Horas</th>
          <th class="num">Valor</th>
          <th></th>
          ${showActions ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${entries.map((e) => `
          <tr>
            <td style="white-space:nowrap">${dateBr(e.workDate)}</td>
            ${showUser ? `<td>${esc(e.userName)}</td>` : ''}
            <td>
              <div>${esc(e.clientName)}</div>
              <div class="small muted">${esc(e.projectName)}${e.projectCode ? ` · ${esc(e.projectCode)}` : ''}</div>
            </td>
            <td class="desc">${esc(e.description)}</td>
            <td class="num">${hm(e.minutes)}</td>
            <td class="num">${e.billable ? brl(e.valueCents) : '—'}</td>
            <td>
              ${!e.billable ? '<span class="tag">não faturável</span>' : ''}
              ${e.locked ? `<span class="tag gold" title="Fechamento ${esc(e.invoiceReference || '')}">fechado</span>` : ''}
            </td>
            ${showActions ? `
            <td class="actions">
              ${e.locked
                ? '<span class="small muted" title="Pertence a um fechamento emitido">bloqueado</span>'
                : `<button class="btn-link" data-edit="${e.id}">editar</button>
                   <button class="btn-link danger" data-del="${e.id}">excluir</button>`}
            </td>` : ''}
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="${(showUser ? 1 : 0) + 3}">Total</td>
          <td class="num">${hm(totalMin)}</td>
          <td class="num">${brl(totalVal)}</td>
          <td colspan="${showActions ? 2 : 1}"></td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

/** Liga os botões editar/excluir de uma tabela de lançamentos. */
function bindEntryActions(container, reload) {
  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { entry } = await API.get(`/api/entries/${btn.dataset.edit}`);
      entryModal(entry, reload);
    });
  });
  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.del;
      const row = btn.closest('tr');
      const resumo = row.querySelector('.desc')?.textContent.trim().slice(0, 90) || '';
      const ok = await confirmDialog(
        'Excluir lançamento',
        `Excluir definitivamente este lançamento?<br><br>
         <span class="muted small">${esc(resumo)}</span><br><br>
         A exclusão fica registrada na trilha de auditoria.`,
        'Excluir'
      );
      if (!ok) return;
      try {
        await API.del(`/api/entries/${id}`);
        toast('Lançamento excluído.', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/** Modal de edição de um lançamento existente. */
function entryModal(entry, reload) {
  openModal({
    title: 'Editar lançamento',
    render: (body) => {
      body.innerHTML = `
        <div class="form-grid">
          ${isMaster() ? `
          <div class="field">
            <label for="m-user">Profissional</label>
            <select id="m-user">${userOptions(entry.userId)}</select>
          </div>` : ''}
          <div class="field">
            <label for="m-date">Data</label>
            <input id="m-date" type="date" value="${entry.workDate}" max="${todayIso()}">
          </div>
          <div class="field">
            <label for="m-duration">Duração</label>
            <input id="m-duration" type="text" value="${hm(entry.minutes)}">
            <span class="help">1:30 · 1h30 · 1,5 · 90</span>
          </div>
          <div class="field span-all">
            <label for="m-project">Cliente e projeto</label>
            <select id="m-project">${projectOptions(entry.projectId)}</select>
          </div>
          <div class="field span-all">
            <label for="m-desc">Descrição da atividade</label>
            <textarea id="m-desc">${esc(entry.description)}</textarea>
          </div>
          ${isMaster() ? `
          <div class="field">
            <label for="m-rate">Valor/hora (R$)</label>
            <input id="m-rate" type="text" value="${brl(entry.rateCents)}">
            <span class="help">Congelado neste lançamento</span>
          </div>` : ''}
          <div class="field span-all">
            <label class="checkbox">
              <input id="m-billable" type="checkbox" ${entry.billable ? 'checked' : ''}> Hora faturável
            </label>
          </div>
        </div>`;
    },
    onConfirm: async (body) => {
      const payload = {
        projectId: body.querySelector('#m-project').value,
        workDate: body.querySelector('#m-date').value,
        duration: body.querySelector('#m-duration').value,
        description: body.querySelector('#m-desc').value,
        billable: body.querySelector('#m-billable').checked,
      };
      if (isMaster()) {
        payload.userId = body.querySelector('#m-user').value;
        payload.rate = body.querySelector('#m-rate').value;
      }
      await API.put(`/api/entries/${entry.id}`, payload);
      toast('Lançamento atualizado.', 'success');
      reload();
      return true;
    },
  });
}

/* ======================================================= tela: lançar horas */

const views = {};

views.lancar = async function lancar(root, nav) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Lançar horas</h2>
        <p>Selecione o cliente, o projeto e informe o tempo dedicado.</p>
      </div>
    </div>

    <div class="card">
      <div class="body">
        <form id="entry-form">
          <div class="form-grid">
            ${isMaster() ? `
            <div class="field">
              <label for="f-user">Profissional</label>
              <select id="f-user">${userOptions(state.user.id)}</select>
              <span class="help">A conta master pode lançar em nome da equipe.</span>
            </div>` : ''}
            <div class="field">
              <label for="f-date">Data</label>
              <input id="f-date" type="date" value="${todayIso()}" max="${todayIso()}" required>
            </div>
            <div class="field">
              <label for="f-duration">Duração</label>
              <input id="f-duration" type="text" placeholder="1:30" required>
              <span class="help">1:30 · 1h30 · 1,5 · 90 (minutos)</span>
            </div>
            <div class="field span-2">
              <label for="f-project">Cliente e projeto</label>
              <select id="f-project" required>
                <option value="">Selecione…</option>
                ${projectOptions()}
              </select>
              <span class="help" id="rate-hint"></span>
            </div>
            <div class="field span-all">
              <label for="f-desc">Descrição da atividade</label>
              <textarea id="f-desc" placeholder="Ex.: Elaboração de contestação e análise da documentação enviada pelo cliente." required></textarea>
              <span class="help">Este texto compõe a memória de cálculo anexada à nota fiscal.</span>
            </div>
            <div class="field span-all">
              <label class="checkbox"><input id="f-billable" type="checkbox" checked> Hora faturável</label>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Lançar horas</button>
            <div class="timer" id="timer">
              <span class="readout" id="timer-readout">00:00:00</span>
              <button type="button" class="btn btn-sm" id="timer-toggle">Iniciar cronômetro</button>
              <button type="button" class="btn btn-sm" id="timer-apply" disabled>Usar tempo</button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div class="card">
      <header><h3>Lançados hoje</h3><div class="spacer"></div>
        <span class="small muted" id="today-total"></span></header>
      <div class="body flush" id="today-list"></div>
    </div>`;

  const form = root.querySelector('#entry-form');
  const projectSelect = root.querySelector('#f-project');
  const rateHint = root.querySelector('#rate-hint');

  // Mostra de antemão o valor/hora que será congelado no lançamento.
  const updateRateHint = () => {
    const project = state.projects.find((p) => String(p.id) === projectSelect.value);
    if (!project) { rateHint.textContent = ''; return; }
    if (project.billingType === 'pro_bono') {
      rateHint.textContent = 'Projeto pro bono — horas registradas sem valor.';
    } else if (project.defaultRateCents != null) {
      rateHint.textContent = `Valor/hora do projeto: ${brlFull(project.defaultRateCents)}`;
    } else {
      rateHint.textContent = 'Sem valor/hora no projeto — será usado o valor do profissional.';
    }
  };
  projectSelect.addEventListener('change', updateRateHint);

  /* --- cronômetro: mede a atividade em curso e preenche o campo de duração --- */
  let startedAt = null;
  let elapsedMs = 0;
  let ticker = null;
  const readout = root.querySelector('#timer-readout');
  const toggle = root.querySelector('#timer-toggle');
  const apply = root.querySelector('#timer-apply');

  const paint = () => {
    const total = elapsedMs + (startedAt ? Date.now() - startedAt : 0);
    const s = Math.floor(total / 1000);
    readout.textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map((n) => String(n).padStart(2, '0')).join(':');
    apply.disabled = total < 60000;   // libera a partir de 1 minuto
  };
  toggle.addEventListener('click', () => {
    if (startedAt) {
      elapsedMs += Date.now() - startedAt;
      startedAt = null;
      clearInterval(ticker);
      toggle.textContent = 'Retomar';
    } else {
      startedAt = Date.now();
      ticker = setInterval(paint, 1000);
      toggle.textContent = 'Pausar';
    }
    paint();
  });
  apply.addEventListener('click', () => {
    const total = elapsedMs + (startedAt ? Date.now() - startedAt : 0);
    form.querySelector('#f-duration').value = hm(Math.round(total / 60000));
    toast('Tempo do cronômetro aplicado à duração.');
  });

  /* ------------------------------------- lista do dia, atualizada a cada envio */
  async function refreshToday() {
    const today = todayIso();
    const data = await API.get(`/api/entries?${qs({ from: today, to: today, limit: 50 })}`);
    if (!stillCurrent(nav)) return;
    const own = isMaster() ? data.entries : data.entries.filter((e) => e.userId === state.user.id);
    root.querySelector('#today-list').innerHTML = entriesTable(own, { showUser: isMaster() });
    root.querySelector('#today-total').textContent =
      own.length ? `${hm(own.reduce((s, e) => s + e.minutes, 0))} hoje` : '';
    bindEntryActions(root.querySelector('#today-list'), refreshToday);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      const payload = {
        projectId: projectSelect.value,
        workDate: form.querySelector('#f-date').value,
        duration: form.querySelector('#f-duration').value,
        description: form.querySelector('#f-desc').value,
        billable: form.querySelector('#f-billable').checked,
      };
      if (isMaster()) payload.userId = form.querySelector('#f-user').value;

      await API.post('/api/entries', payload);
      toast('Horas lançadas.', 'success');

      // Mantém data, projeto e profissional: o padrão de uso é lançar várias
      // atividades seguidas do mesmo caso.
      form.querySelector('#f-duration').value = '';
      form.querySelector('#f-desc').value = '';
      form.querySelector('#f-duration').focus();
      elapsedMs = 0; startedAt = null; clearInterval(ticker);
      toggle.textContent = 'Iniciar cronômetro'; paint();

      await refreshToday();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  updateRateHint();
  paint();
  await refreshToday();
};

/* ============================== telas: meus lançamentos / horas do escritório */

function periodFilterBar({ showUser = false, showInvoiced = false, prefix }) {
  const f = state.filters[prefix] || (state.filters[prefix] = { ...monthRange(0) });
  return `
    <div class="card no-print">
      <div class="body">
        <div class="filters">
          <div class="field">
            <label for="${prefix}-from">De</label>
            <input id="${prefix}-from" type="date" value="${f.from || ''}">
          </div>
          <div class="field">
            <label for="${prefix}-to">Até</label>
            <input id="${prefix}-to" type="date" value="${f.to || ''}">
          </div>
          <div class="field">
            <label for="${prefix}-client">Cliente</label>
            <select id="${prefix}-client">${clientOptions(f.clientId, { includeAll: true })}</select>
          </div>
          ${showUser ? `
          <div class="field">
            <label for="${prefix}-user">Profissional</label>
            <select id="${prefix}-user">${userOptions(f.userId, { includeAll: true })}</select>
          </div>` : ''}
          <div class="field">
            <label for="${prefix}-billable">Faturável</label>
            <select id="${prefix}-billable">
              <option value="">Todas as horas</option>
              <option value="true"  ${f.billable === 'true' ? 'selected' : ''}>Somente faturáveis</option>
              <option value="false" ${f.billable === 'false' ? 'selected' : ''}>Somente não faturáveis</option>
            </select>
          </div>
          ${showInvoiced ? `
          <div class="field">
            <label for="${prefix}-invoiced">Fechamento</label>
            <select id="${prefix}-invoiced">
              <option value="">Todas</option>
              <option value="no"  ${f.invoiced === 'no' ? 'selected' : ''}>Em aberto</option>
              <option value="yes" ${f.invoiced === 'yes' ? 'selected' : ''}>Já fechadas</option>
            </select>
          </div>` : ''}
          <div class="field">
            <label for="${prefix}-search">Buscar na descrição</label>
            <input id="${prefix}-search" type="text" value="${esc(f.search || '')}" placeholder="palavra-chave">
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="${prefix}-apply" type="button">Aplicar filtros</button>
          <div class="chips">
            <button class="chip" data-range="0" type="button">Mês atual</button>
            <button class="chip" data-range="-1" type="button">Mês anterior</button>
            <button class="chip" data-range="year" type="button">Ano</button>
          </div>
          <div class="spacer" style="flex:1"></div>
          <button class="btn" id="${prefix}-csv" type="button">Exportar CSV</button>
        </div>
      </div>
    </div>`;
}

/** Lê os filtros do DOM, guarda no estado e devolve a querystring. */
function readFilters(root, prefix) {
  const value = (suffix) => root.querySelector(`#${prefix}-${suffix}`)?.value ?? '';
  const f = {
    from: value('from'), to: value('to'),
    clientId: value('client'), userId: value('user'),
    billable: value('billable'), invoiced: value('invoiced'),
    search: value('search'),
  };
  state.filters[prefix] = f;
  return qs(f);
}

function bindFilterBar(root, prefix, reload) {
  root.querySelector(`#${prefix}-apply`).addEventListener('click', reload);
  root.querySelectorAll(`[data-range]`).forEach((chip) => {
    chip.addEventListener('click', () => {
      const kind = chip.dataset.range;
      const range = kind === 'year'
        ? { from: `${new Date().getFullYear()}-01-01`, to: todayIso() }
        : monthRange(Number(kind));
      root.querySelector(`#${prefix}-from`).value = range.from;
      root.querySelector(`#${prefix}-to`).value = range.to;
      reload();
    });
  });
  root.querySelector(`#${prefix}-search`).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') reload();
  });
  root.querySelector(`#${prefix}-csv`).addEventListener('click', () => {
    window.location.href = `/api/reports/export.csv?${readFilters(root, prefix)}`;
  });
}

function entriesView({ title, subtitle, prefix, showUser, showInvoiced }) {
  return async function render(root, nav) {
    root.innerHTML = `
      <div class="page-head">
        <div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
      </div>
      ${periodFilterBar({ showUser, showInvoiced, prefix })}
      <div id="${prefix}-stats"></div>
      <div class="card"><div class="body flush" id="${prefix}-list">
        <div class="empty">Carregando…</div>
      </div></div>`;

    async function reload() {
      const query = readFilters(root, prefix);
      try {
        const data = await API.get(`/api/entries?${query}&limit=500`);
        if (!stillCurrent(nav)) return;
        root.querySelector(`#${prefix}-stats`).innerHTML = statsRow({
          ...data.totals, entries: data.totals.count,
        });
        const list = root.querySelector(`#${prefix}-list`);
        list.innerHTML = entriesTable(data.entries, { showUser });
        if (data.page.hasMore) {
          list.insertAdjacentHTML('beforeend',
            `<div class="empty small">Exibindo os 500 lançamentos mais recentes do período.
             Refine os filtros ou use a exportação CSV para ver todos.</div>`);
        }
        bindEntryActions(list, reload);
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    bindFilterBar(root, prefix, reload);
    await reload();
  };
}

views.meus = entriesView({
  title: 'Meus lançamentos',
  subtitle: 'Suas horas. Você pode editar e excluir qualquer lançamento seu que ainda não tenha sido fechado.',
  prefix: 'meus',
  showUser: false,
  showInvoiced: true,
});

views.escritorio = entriesView({
  title: 'Horas do escritório',
  subtitle: 'Todas as horas de todos os profissionais. A conta master pode editar e excluir qualquer lançamento.',
  prefix: 'esc',
  showUser: true,
  showInvoiced: true,
});

/* ======================================================== tela: relatórios */

views.relatorios = async function relatorios(root, nav) {
  const prefix = 'rel';
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Relatórios</h2>
        <p>Consolidação de horas e valores por cliente, projeto, profissional ou período.</p></div>
    </div>
    ${periodFilterBar({ showUser: isMaster(), showInvoiced: true, prefix })}
    <div class="card no-print">
      <div class="body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <label for="rel-group" style="font-size:12.5px;font-weight:600;color:var(--ink-soft)">Agrupar por</label>
        <select id="rel-group" style="max-width:220px">
          <option value="client">Cliente</option>
          <option value="project">Projeto</option>
          ${isMaster() ? '<option value="user">Profissional</option>' : ''}
          <option value="month">Mês</option>
          <option value="date">Dia</option>
        </select>
        <div class="spacer" style="flex:1"></div>
        <button class="btn" id="rel-print" type="button">Imprimir / PDF</button>
      </div>
    </div>
    <div id="rel-stats"></div>
    <div class="card"><header><h3 id="rel-title">Consolidado</h3></header>
      <div class="body flush" id="rel-table"></div></div>
    <div id="rel-byuser"></div>`;

  async function reload() {
    const groupBy = root.querySelector('#rel-group').value;
    const query = readFilters(root, prefix);
    try {
      const data = await API.get(`/api/reports/summary?${query}&groupBy=${groupBy}`);
      if (!stillCurrent(nav)) return;
      root.querySelector('#rel-stats').innerHTML = statsRow(data.totals);
      root.querySelector('#rel-title').textContent =
        `Consolidado por ${{ client: 'cliente', project: 'projeto', user: 'profissional', month: 'mês', date: 'dia' }[groupBy]}`;
      root.querySelector('#rel-table').innerHTML = groupTable(data.groups, data.totals);
      root.querySelector('#rel-byuser').innerHTML =
        data.byUser && groupBy !== 'user'
          ? `<div class="card"><header><h3>Produção por profissional</h3></header>
             <div class="body flush">${groupTable(data.byUser, data.totals)}</div></div>`
          : '';
    } catch (err) { toast(err.message, 'error'); }
  }

  bindFilterBar(root, prefix, reload);
  root.querySelector('#rel-group').addEventListener('change', reload);
  root.querySelector('#rel-print').addEventListener('click', () => window.print());
  await reload();
};

function groupTable(groups, totals) {
  if (!groups.length) return '<div class="empty">Sem dados para o período selecionado.</div>';
  const maxMinutes = Math.max(...groups.map((g) => g.minutes), 1);
  return `
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th></th><th class="num">Lançamentos</th><th class="num">Horas</th>
        <th class="num">Decimal</th><th class="num">Faturáveis</th><th class="num">Valor (R$)</th>
        <th class="num">% horas</th>
      </tr></thead>
      <tbody>
        ${groups.map((g) => `
          <tr>
            <td>${esc(g.name)}</td>
            <td class="num">${g.entries}</td>
            <td class="num">${hm(g.minutes)}</td>
            <td class="num">${dec(g.minutes)}</td>
            <td class="num">${hm(g.billableMinutes)}</td>
            <td class="num">${brl(g.valueCents)}</td>
            <td class="num">${totals.minutes ? Math.round((g.minutes / totals.minutes) * 100) : 0}%</td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td>Total</td>
        <td class="num">${groups.reduce((s, g) => s + g.entries, 0)}</td>
        <td class="num">${hm(totals.minutes)}</td>
        <td class="num">${dec(totals.minutes)}</td>
        <td class="num">${hm(totals.billableMinutes)}</td>
        <td class="num">${brl(totals.valueCents)}</td>
        <td class="num">100%</td>
      </tr></tfoot>
    </table>
  </div>`;
}

/* ====================================================== tela: nota fiscal */

views.nota = async function nota(root, nav) {
  const range = state.filters.nota || (state.filters.nota = monthRange(-1));
  root.innerHTML = `
    <div class="page-head no-print">
      <div><h2>Memória de cálculo para nota fiscal</h2>
        <p>Selecione cliente e período para gerar o demonstrativo de horas que acompanha a NF de honorários.</p></div>
    </div>

    <div class="card no-print">
      <div class="body">
        <div class="filters">
          <div class="field">
            <label for="nf-client">Cliente</label>
            <select id="nf-client">${clientOptions(range.clientId)}</select>
          </div>
          <div class="field"><label for="nf-from">De</label>
            <input id="nf-from" type="date" value="${range.from}"></div>
          <div class="field"><label for="nf-to">Até</label>
            <input id="nf-to" type="date" value="${range.to}"></div>
          <div class="field">
            <label for="nf-detail">Detalhamento</label>
            <select id="nf-detail">
              <option value="summary">Resumido (por projeto e profissional)</option>
              <option value="full">Analítico (todas as atividades)</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="nf-go" type="button">Gerar demonstrativo</button>
          <div class="chips">
            <button class="chip" data-nfrange="-1" type="button">Mês anterior</button>
            <button class="chip" data-nfrange="0" type="button">Mês atual</button>
          </div>
          <div class="spacer" style="flex:1"></div>
          <button class="btn" id="nf-print" type="button" disabled>Imprimir / PDF</button>
          <button class="btn" id="nf-csv" type="button" disabled>Exportar CSV</button>
          <button class="btn btn-primary" id="nf-close" type="button" disabled>Fechar período</button>
        </div>
      </div>
    </div>

    <div id="nf-out"></div>

    <div class="card no-print" id="nf-invoices">
      <header><h3>Fechamentos emitidos</h3><div class="spacer"></div>
        <span class="small muted">Lançamentos de um período fechado ficam bloqueados para edição.</span></header>
      <div class="body flush" id="nf-invoice-list"></div>
    </div>`;

  const out = root.querySelector('#nf-out');

  async function generate() {
    const clientId = root.querySelector('#nf-client').value;
    const from = root.querySelector('#nf-from').value;
    const to = root.querySelector('#nf-to').value;
    if (!clientId || !from || !to) return toast('Informe cliente e período.', 'error');
    state.filters.nota = { clientId, from, to };

    try {
      const data = await API.get(`/api/reports/invoice?${qs({ clientId, from, to })}`);
      if (!stillCurrent(nav)) return;
      state.lastReport = data;
      const detail = root.querySelector('#nf-detail').value === 'full';
      out.innerHTML = renderInvoiceReport(data, detail);
      for (const id of ['nf-print', 'nf-csv', 'nf-close']) {
        root.querySelector(`#${id}`).disabled = data.totals.entries === 0;
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  async function loadInvoices() {
    try {
      const { invoices } = await API.get('/api/invoices');
      if (!stillCurrent(nav)) return;
      const list = root.querySelector('#nf-invoice-list');
      list.innerHTML = invoices.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Referência</th><th>Cliente</th><th>Período</th>
            <th class="num">Lançamentos</th><th class="num">Horas</th><th class="num">Valor</th>
            <th>Situação</th><th></th></tr></thead>
          <tbody>${invoices.map((i) => `
            <tr>
              <td>${esc(i.reference)}</td>
              <td>${esc(i.clientName)}</td>
              <td style="white-space:nowrap">${dateBr(i.periodStart)} – ${dateBr(i.periodEnd)}</td>
              <td class="num">${i.entryCount}</td>
              <td class="num">${i.totalHours}</td>
              <td class="num">${brl(i.totalCents)}</td>
              <td><span class="tag ${INVOICE_STATUS[i.status].cls}">${INVOICE_STATUS[i.status].label}</span></td>
              <td class="actions">
                ${i.status !== 'invoiced'
                  ? `<button class="btn-link" data-invoiced="${i.id}">marcar faturado</button>` : ''}
                <button class="btn-link danger" data-reopen="${i.id}">reabrir</button>
              </td>
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Nenhum fechamento emitido ainda.</div>';

      list.querySelectorAll('[data-invoiced]').forEach((b) => b.addEventListener('click', async () => {
        await API.patch(`/api/invoices/${b.dataset.invoiced}`, { status: 'invoiced' });
        toast('Fechamento marcado como faturado.', 'success');
        loadInvoices();
      }));
      list.querySelectorAll('[data-reopen]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog('Reabrir fechamento',
          'Reabrir devolve todos os lançamentos do período ao estado editável e apaga este fechamento.<br><br>Confirma?',
          'Reabrir');
        if (!ok) return;
        const res = await API.del(`/api/invoices/${b.dataset.reopen}`);
        toast(`Fechamento reaberto — ${res.releasedEntries} lançamento(s) liberado(s).`, 'success');
        loadInvoices();
      }));
    } catch (err) { toast(err.message, 'error'); }
  }

  root.querySelector('#nf-go').addEventListener('click', generate);
  root.querySelector('#nf-detail').addEventListener('change', () => {
    if (state.lastReport) {
      out.innerHTML = renderInvoiceReport(state.lastReport, root.querySelector('#nf-detail').value === 'full');
    }
  });
  root.querySelectorAll('[data-nfrange]').forEach((chip) => chip.addEventListener('click', () => {
    const r = monthRange(Number(chip.dataset.nfrange));
    root.querySelector('#nf-from').value = r.from;
    root.querySelector('#nf-to').value = r.to;
    generate();
  }));
  root.querySelector('#nf-print').addEventListener('click', () => window.print());
  root.querySelector('#nf-csv').addEventListener('click', () => {
    const { clientId, from, to } = state.filters.nota;
    window.location.href = `/api/reports/export.csv?${qs({ clientId, from, to })}`;
  });
  root.querySelector('#nf-close').addEventListener('click', () => closePeriodModal(loadInvoices));

  await loadInvoices();
};

function renderInvoiceReport(data, detailed) {
  const doc = data.client.document;
  const docLabel = doc
    ? (doc.length === 14
        ? `CNPJ ${doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`
        : `CPF ${doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`)
    : '';

  return `
  <div class="card">
    <div class="body">
      <div class="print-only" style="margin-bottom:14px">
        <strong style="font-size:15pt">${esc(state.firm?.name || 'Azeredo & Ugatti Advogados')}</strong><br>
        <span class="muted small">Demonstrativo de horas — anexo à nota fiscal de honorários</span>
      </div>
      <h3 style="font-size:17px">${esc(data.client.name)}</h3>
      <p class="muted small" style="margin:4px 0 0">
        ${esc(docLabel)}${docLabel ? ' · ' : ''}Período de ${dateBr(data.period.from)} a ${dateBr(data.period.to)}
        · emitido em ${dateTimeBr(data.generatedAt)}
      </p>
    </div>
  </div>

  ${statsRow({ ...data.totals, entries: data.totals.entries })}

  ${data.totals.entries === 0
    ? '<div class="card"><div class="empty">Nenhuma hora lançada para este cliente no período.</div></div>'
    : data.projects.map((p) => `
    <div class="card">
      <header>
        <h3>${esc(p.projectName)}</h3>
        ${p.projectCode ? `<span class="tag">${esc(p.projectCode)}</span>` : ''}
        <span class="tag">${esc(BILLING_LABEL[p.billingType] || p.billingType)}</span>
        <div class="spacer"></div>
        <strong>${p.hours} h · ${brlFull(p.valueCents)}</strong>
      </header>
      <div class="body flush">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Profissional</th><th class="num">Horas</th><th class="num">Decimal</th>
              <th class="num">Valor/hora</th><th class="num">Valor</th></tr></thead>
            <tbody>
              ${p.professionals.map((prof) => `
                <tr>
                  <td>${esc(prof.userName)}</td>
                  <td class="num">${hm(prof.minutes)}</td>
                  <td class="num">${dec(prof.minutes)}</td>
                  <td class="num">${brl(prof.rateCents)}</td>
                  <td class="num">${brl(prof.valueCents)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${detailed ? `
        <div class="table-wrap" style="border-top:1px solid var(--line)">
          <table>
            <thead><tr><th>Data</th><th>Profissional</th><th>Atividade</th>
              <th class="num">Horas</th><th class="num">Valor</th></tr></thead>
            <tbody>
              ${p.entries.map((e) => `
                <tr>
                  <td style="white-space:nowrap">${dateBr(e.workDate)}</td>
                  <td>${esc(e.userName)}</td>
                  <td class="desc">${esc(e.description)}</td>
                  <td class="num">${hm(e.minutes)}</td>
                  <td class="num">${e.billable ? brl(e.valueCents) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div>
    </div>`).join('')}

  ${data.totals.entries === 0 ? '' : `
  <div class="card">
    <div class="body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <div class="label small muted" style="text-transform:uppercase;letter-spacing:.06em">Total do período</div>
        <div style="font-size:26px;font-weight:600;color:var(--gold)">${brlFull(data.totals.valueCents)}</div>
      </div>
      <div class="spacer" style="flex:1"></div>
      <div class="small muted" style="text-align:right">
        ${hm(data.totals.minutes)} h lançadas · ${hm(data.totals.billableMinutes)} h faturáveis<br>
        ${data.totals.entries} atividade(s) registrada(s)
      </div>
    </div>
  </div>`}`;
}

function closePeriodModal(reload) {
  const { clientId, from, to } = state.filters.nota || {};
  const client = state.clients.find((c) => String(c.id) === String(clientId));
  const sugestao = `NF ${from ? from.slice(0, 7) : ''}`;

  openModal({
    title: 'Fechar período',
    render: (body) => {
      body.innerHTML = `
        <div class="alert info">
          Fechar marca as horas faturáveis de <strong>${esc(client?.name || '')}</strong> entre
          ${dateBr(from)} e ${dateBr(to)} como faturadas, bloqueando edição e exclusão.
          O período pode ser reaberto depois.
        </div>
        <div class="form-grid">
          <div class="field span-all">
            <label for="ci-ref">Referência</label>
            <input id="ci-ref" type="text" value="${esc(sugestao)}" placeholder="NF 2026/014">
            <span class="help">Identificação do fechamento — normalmente o número da nota ou a competência.</span>
          </div>
          <div class="field span-all">
            <label for="ci-notes">Observações</label>
            <textarea id="ci-notes" placeholder="Opcional"></textarea>
          </div>
          <div class="field span-all">
            <label class="checkbox">
              <input id="ci-nonbillable" type="checkbox"> Incluir também as horas não faturáveis
            </label>
          </div>
        </div>`;
    },
    confirmLabel: 'Fechar período',
    onConfirm: async (body) => {
      await API.post('/api/invoices', {
        clientId, from, to,
        reference: body.querySelector('#ci-ref').value,
        notes: body.querySelector('#ci-notes').value,
        includeNonBillable: body.querySelector('#ci-nonbillable').checked,
      });
      toast('Período fechado.', 'success');
      reload();
      return true;
    },
  });
}

/* ============================================ tela: clientes e projetos */

views.clientes = async function clientes(root, nav) {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Clientes e projetos</h2>
        <p>Cadastros disponíveis para lançamento de horas. Registros com horas lançadas são arquivados, nunca apagados.</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="new-client" type="button">Novo cliente</button>
      <button class="btn" id="new-project" type="button">Novo projeto</button>
    </div>
    <div class="card"><header><h3>Clientes</h3><div class="spacer"></div>
      <label class="checkbox small"><input type="checkbox" id="show-archived"> Mostrar arquivados</label>
      </header><div class="body flush" id="client-list"></div></div>
    <div class="card"><header><h3>Projetos</h3></header>
      <div class="body flush" id="project-list"></div></div>`;

  const showArchived = () => root.querySelector('#show-archived').checked;

  async function reload() {
    const query = showArchived() ? '?includeInactive=true' : '';
    const [{ clients }, { projects }] = await Promise.all([
      API.get(`/api/clients${query}`), API.get(`/api/projects${query}`),
    ]);
    if (!stillCurrent(nav)) return;
    state.clients = clients.filter((c) => c.active);
    state.projects = projects.filter((p) => p.active);

    root.querySelector('#client-list').innerHTML = clients.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>CPF/CNPJ</th><th>E-mail</th>
          <th class="num">Projetos</th><th>Situação</th><th></th></tr></thead>
        <tbody>${clients.map((c) => `
          <tr>
            <td>${esc(c.name)}</td>
            <td class="small">${esc(formatDoc(c.document))}</td>
            <td class="small">${esc(c.email || '—')}</td>
            <td class="num">${c.projectCount ?? 0}</td>
            <td>${c.active ? '<span class="tag ok">ativo</span>' : '<span class="tag">arquivado</span>'}</td>
            <td class="actions">
              <button class="btn-link" data-edit-client="${c.id}">editar</button>
              ${c.active ? `<button class="btn-link danger" data-del-client="${c.id}">arquivar</button>` : ''}
            </td>
          </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum cliente cadastrado. Comece criando um cliente.</div>';

    root.querySelector('#project-list').innerHTML = projects.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Projeto</th><th>Código / processo</th>
          <th>Cobrança</th><th class="num">Valor/hora</th><th>Situação</th><th></th></tr></thead>
        <tbody>${projects.map((p) => `
          <tr>
            <td>${esc(p.clientName)}</td>
            <td>${esc(p.name)}</td>
            <td class="small">${esc(p.code || '—')}</td>
            <td>${esc(BILLING_LABEL[p.billingType])}</td>
            <td class="num">${p.defaultRateCents != null ? brl(p.defaultRateCents) : '<span class="muted">do profissional</span>'}</td>
            <td>${p.active ? '<span class="tag ok">ativo</span>' : '<span class="tag">arquivado</span>'}</td>
            <td class="actions">
              <button class="btn-link" data-edit-project="${p.id}">editar</button>
              ${p.active ? `<button class="btn-link danger" data-del-project="${p.id}">arquivar</button>` : ''}
            </td>
          </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum projeto cadastrado.</div>';

    root.querySelectorAll('[data-edit-client]').forEach((b) => b.addEventListener('click', () =>
      clientModal(clients.find((c) => String(c.id) === b.dataset.editClient), reload)));
    root.querySelectorAll('[data-edit-project]').forEach((b) => b.addEventListener('click', () =>
      projectModal(projects.find((p) => String(p.id) === b.dataset.editProject), reload)));

    root.querySelectorAll('[data-del-client]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Arquivar cliente',
        'O cliente e seus projetos deixam de aceitar novos lançamentos. O histórico de horas é preservado nos relatórios.<br><br>Se nunca houve lançamento, o cadastro é removido de vez.',
        'Arquivar');
      if (!ok) return;
      try {
        const res = await API.del(`/api/clients/${b.dataset.delClient}`);
        toast(res.archived ? `Cliente arquivado (${res.entries} lançamentos preservados).` : 'Cliente removido.', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    }));

    root.querySelectorAll('[data-del-project]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Arquivar projeto',
        'O projeto deixa de aceitar novos lançamentos. O histórico é preservado.', 'Arquivar');
      if (!ok) return;
      try {
        const res = await API.del(`/api/projects/${b.dataset.delProject}`);
        toast(res.archived ? `Projeto arquivado (${res.entries} lançamentos preservados).` : 'Projeto removido.', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  root.querySelector('#show-archived').addEventListener('change', reload);
  root.querySelector('#new-client').addEventListener('click', () => clientModal(null, reload));
  root.querySelector('#new-project').addEventListener('click', () => projectModal(null, reload));
  await reload();
};

const formatDoc = (doc) => {
  if (!doc) return '—';
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc;
};

function clientModal(client, reload) {
  openModal({
    title: client ? 'Editar cliente' : 'Novo cliente',
    render: (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="field span-all">
            <label for="c-name">Nome / razão social</label>
            <input id="c-name" type="text" value="${esc(client?.name || '')}" required>
          </div>
          <div class="field">
            <label for="c-doc">CPF / CNPJ</label>
            <input id="c-doc" type="text" value="${esc(formatDoc(client?.document) === '—' ? '' : formatDoc(client?.document))}" placeholder="00.000.000/0000-00">
          </div>
          <div class="field">
            <label for="c-email">E-mail de faturamento</label>
            <input id="c-email" type="email" value="${esc(client?.email || '')}">
          </div>
          <div class="field span-all">
            <label for="c-notes">Observações</label>
            <textarea id="c-notes">${esc(client?.notes || '')}</textarea>
          </div>
          ${client ? `<div class="field span-all">
            <label class="checkbox"><input id="c-active" type="checkbox" ${client.active ? 'checked' : ''}> Cliente ativo</label>
          </div>` : ''}
        </div>`;
    },
    onConfirm: async (body) => {
      const payload = {
        name: body.querySelector('#c-name').value,
        document: body.querySelector('#c-doc').value,
        email: body.querySelector('#c-email').value,
        notes: body.querySelector('#c-notes').value,
      };
      if (client) payload.active = body.querySelector('#c-active').checked;
      if (client) await API.put(`/api/clients/${client.id}`, payload);
      else await API.post('/api/clients', payload);
      toast(client ? 'Cliente atualizado.' : 'Cliente criado.', 'success');
      reload();
      return true;
    },
  });
}

function projectModal(project, reload) {
  openModal({
    title: project ? 'Editar projeto' : 'Novo projeto',
    render: (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="field span-all">
            <label for="p-client">Cliente</label>
            <select id="p-client">${clientOptions(project?.clientId)}</select>
          </div>
          <div class="field span-all">
            <label for="p-name">Nome do projeto / caso</label>
            <input id="p-name" type="text" value="${esc(project?.name || '')}" required>
          </div>
          <div class="field">
            <label for="p-code">Código ou nº do processo</label>
            <input id="p-code" type="text" value="${esc(project?.code || '')}">
          </div>
          <div class="field">
            <label for="p-billing">Tipo de cobrança</label>
            <select id="p-billing">
              ${Object.entries(BILLING_LABEL).map(([k, label]) =>
                `<option value="${k}" ${project?.billingType === k ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
          <div class="field span-all">
            <label for="p-rate">Valor/hora do projeto (R$)</label>
            <input id="p-rate" type="text" value="${project?.defaultRateCents != null ? brl(project.defaultRateCents) : ''}" placeholder="deixe vazio para usar o valor de cada profissional">
            <span class="help">Quando preenchido, prevalece sobre o valor/hora individual.</span>
          </div>
          ${project ? `<div class="field span-all">
            <label class="checkbox"><input id="p-active" type="checkbox" ${project.active ? 'checked' : ''}> Projeto ativo</label>
          </div>` : ''}
        </div>`;
    },
    onConfirm: async (body) => {
      const payload = {
        clientId: body.querySelector('#p-client').value,
        name: body.querySelector('#p-name').value,
        code: body.querySelector('#p-code').value,
        billingType: body.querySelector('#p-billing').value,
        defaultRate: body.querySelector('#p-rate').value,
      };
      if (project) payload.active = body.querySelector('#p-active').checked;
      if (project) await API.put(`/api/projects/${project.id}`, payload);
      else await API.post('/api/projects', payload);
      toast(project ? 'Projeto atualizado.' : 'Projeto criado.', 'success');
      reload();
      return true;
    },
  });
}

/* ========================================================= tela: usuários */

views.usuarios = async function usuarios(root, nav) {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Usuários</h2>
        <p>Contas de acesso. A conta master administra cadastros e enxerga as horas de todo o escritório.</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="new-user" type="button">Novo usuário</button>
    </div>
    <div class="card"><div class="body flush" id="user-list"></div></div>`;

  async function reload() {
    const { users } = await API.get('/api/users');
    if (!stillCurrent(nav)) return;
    state.users = users;
    root.querySelector('#user-list').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>OAB</th><th>Perfil</th>
          <th class="num">Valor/hora</th><th>Situação</th><th></th></tr></thead>
        <tbody>${users.map((u) => `
          <tr>
            <td>${esc(u.name)}${u.id === state.user.id ? ' <span class="tag">você</span>' : ''}</td>
            <td class="small">${esc(u.email)}</td>
            <td class="small">${esc(u.oab || '—')}</td>
            <td>${u.role === 'master'
              ? '<span class="tag gold">master</span>' : '<span class="tag">profissional</span>'}</td>
            <td class="num">${u.hourlyRateCents != null ? brl(u.hourlyRateCents) : '—'}</td>
            <td>${u.active ? '<span class="tag ok">ativo</span>' : '<span class="tag danger">inativo</span>'}</td>
            <td class="actions">
              <button class="btn-link" data-edit-user="${u.id}">editar</button>
              <button class="btn-link" data-reset="${u.id}">redefinir senha</button>
              ${u.active && u.id !== state.user.id
                ? `<button class="btn-link danger" data-off="${u.id}">desativar</button>` : ''}
            </td>
          </tr>`).join('')}</tbody></table></div>`;

    root.querySelectorAll('[data-edit-user]').forEach((b) => b.addEventListener('click', () =>
      userModal(users.find((u) => String(u.id) === b.dataset.editUser), reload)));

    root.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Redefinir senha',
        'Uma nova senha provisória será gerada e todas as sessões deste usuário serão encerradas.<br><br>Confirma?',
        'Redefinir');
      if (!ok) return;
      try {
        const res = await API.post(`/api/users/${b.dataset.reset}/password`);
        showProvisionalPassword(res.provisionalPassword);
      } catch (err) { toast(err.message, 'error'); }
    }));

    root.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Desativar usuário',
        'O usuário perde o acesso imediatamente. As horas já lançadas por ele são preservadas nos relatórios.',
        'Desativar');
      if (!ok) return;
      try {
        await API.del(`/api/users/${b.dataset.off}`);
        toast('Usuário desativado.', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  root.querySelector('#new-user').addEventListener('click', () => userModal(null, reload));
  await reload();
};

function showProvisionalPassword(password) {
  openModal({
    title: 'Senha provisória',
    render: (body) => {
      body.innerHTML = `
        <div class="alert info">Anote e entregue ao profissional por um canal seguro.
          Esta senha <strong>não será exibida novamente</strong>; oriente a troca no primeiro acesso.</div>
        <div style="font-family:var(--mono);font-size:22px;text-align:center;padding:16px;
                    background:#f5f7fa;border:1px solid var(--line);border-radius:6px;user-select:all">
          ${esc(password)}
        </div>`;
    },
    confirmLabel: 'Copiar',
    onConfirm: async () => {
      try { await navigator.clipboard.writeText(password); toast('Senha copiada.', 'success'); }
      catch { toast('Copie manualmente o texto exibido.', 'error'); }
      return true;
    },
  });
}

function userModal(user, reload) {
  openModal({
    title: user ? 'Editar usuário' : 'Novo usuário',
    render: (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="field span-all">
            <label for="u-name">Nome</label>
            <input id="u-name" type="text" value="${esc(user?.name || '')}" required>
          </div>
          <div class="field span-all">
            <label for="u-email">E-mail (login)</label>
            <input id="u-email" type="email" value="${esc(user?.email || '')}" required>
          </div>
          <div class="field">
            <label for="u-oab">OAB</label>
            <input id="u-oab" type="text" value="${esc(user?.oab || '')}" placeholder="SP 123.456">
          </div>
          <div class="field">
            <label for="u-rate">Valor/hora (R$)</label>
            <input id="u-rate" type="text" value="${user?.hourlyRateCents != null ? brl(user.hourlyRateCents) : ''}">
          </div>
          <div class="field span-all">
            <label for="u-role">Perfil de acesso</label>
            <select id="u-role">
              <option value="user"   ${user?.role !== 'master' ? 'selected' : ''}>Profissional — lança e gerencia apenas as próprias horas</option>
              <option value="master" ${user?.role === 'master' ? 'selected' : ''}>Master — acesso total, cadastros e relatórios</option>
            </select>
          </div>
          ${user ? `<div class="field span-all">
            <label class="checkbox"><input id="u-active" type="checkbox" ${user.active ? 'checked' : ''}> Usuário ativo</label>
          </div>` : `<div class="field span-all">
            <span class="help">Uma senha provisória será gerada automaticamente e exibida uma única vez.</span>
          </div>`}
        </div>`;
    },
    onConfirm: async (body) => {
      const payload = {
        name: body.querySelector('#u-name').value,
        email: body.querySelector('#u-email').value,
        oab: body.querySelector('#u-oab').value,
        hourlyRate: body.querySelector('#u-rate').value,
        role: body.querySelector('#u-role').value,
      };
      if (user) {
        payload.active = body.querySelector('#u-active').checked;
        await API.put(`/api/users/${user.id}`, payload);
        toast('Usuário atualizado.', 'success');
        reload();
      } else {
        const res = await API.post('/api/users', payload);
        reload();
        showProvisionalPassword(res.provisionalPassword);
      }
      return true;
    },
  });
}

/* ======================================================== tela: auditoria */

const AUDIT_LABEL = {
  create: 'criação', update: 'alteração', delete: 'exclusão', archive: 'arquivamento',
  deactivate: 'desativação', login: 'login', logout: 'logout', login_failed: 'login recusado',
  password_change: 'troca de senha', password_reset: 'reset de senha', bootstrap: 'criação inicial',
};
const ENTITY_LABEL = {
  time_entry: 'lançamento', client: 'cliente', project: 'projeto',
  user: 'usuário', invoice: 'fechamento',
};

views.auditoria = async function auditoria(root, nav) {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Trilha de auditoria</h2>
        <p>Registro de quem criou, alterou e excluiu lançamentos e cadastros — inclusive o conteúdo do que foi apagado.</p></div>
    </div>
    <div class="card"><div class="body flush" id="audit-list"><div class="empty">Carregando…</div></div></div>`;

  const { events } = await API.get('/api/reports/audit?limit=400');
  if (!stillCurrent(nav)) return;
  root.querySelector('#audit-list').innerHTML = events.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th><th>Detalhes</th></tr></thead>
      <tbody>${events.map((e) => `
        <tr>
          <td class="small" style="white-space:nowrap">${dateTimeBr(e.at)}</td>
          <td>${esc(e.actorName || 'sistema')}</td>
          <td><span class="tag ${e.action === 'delete' ? 'danger' : e.action === 'create' ? 'ok' : ''}">${esc(AUDIT_LABEL[e.action] || e.action)}</span></td>
          <td class="small">${esc(ENTITY_LABEL[e.entity] || e.entity)}${e.entityId ? ` #${e.entityId}` : ''}</td>
          <td class="small muted desc">${esc(summarizeAudit(e))}</td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhum evento registrado.</div>';
};

function summarizeAudit(event) {
  const d = event.details;
  if (!d) return '';
  if (event.entity === 'time_entry' && event.action === 'delete') {
    return `${dateBr(d.workDate)} · ${hm(d.minutes)} h · ${d.description || ''}`;
  }
  if (event.entity === 'time_entry' && event.action === 'update' && d.before) {
    return `${hm(d.before.minutes)} h → ${hm(d.after.minutes)} h · ${dateBr(d.before.workDate)} → ${dateBr(d.after.workDate)}`;
  }
  if (event.entity === 'time_entry' && event.action === 'create') {
    return `${dateBr(d.workDate)} · ${hm(d.minutes)} h${d.onBehalf ? ' · lançado em nome de terceiro' : ''}`;
  }
  if (event.entity === 'invoice' && d.reference) return `${d.reference}`;
  if (d.name) return d.name;
  if (d.email) return d.email;
  return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 160);
}

/* ========================================================= conta do usuário */

function accountModal() {
  openModal({
    title: 'Minha conta',
    render: (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="field span-all">
            <label>Nome</label>
            <input type="text" value="${esc(state.user.name)}" disabled>
          </div>
          <div class="field span-all">
            <label>E-mail</label>
            <input type="text" value="${esc(state.user.email)}" disabled>
          </div>
          <div class="field span-all">
            <label>Perfil</label>
            <input type="text" value="${state.user.role === 'master' ? 'Master — acesso total' : 'Profissional'}" disabled>
          </div>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
        <h3 style="font-size:14px;margin-bottom:12px">Alterar senha</h3>
        <div class="form-grid">
          <div class="field span-all">
            <label for="a-current">Senha atual</label>
            <input id="a-current" type="password" autocomplete="current-password">
          </div>
          <div class="field span-all">
            <label for="a-new">Nova senha</label>
            <input id="a-new" type="password" autocomplete="new-password">
            <span class="help">Mínimo de 10 caracteres, com letras e números.</span>
          </div>
        </div>
        <div class="alert info small" style="margin:14px 0 0">
          Ao trocar a senha, as sessões abertas em outros dispositivos são encerradas.
        </div>`;
    },
    confirmLabel: 'Alterar senha',
    onConfirm: async (body) => {
      await API.post('/api/auth/password', {
        currentPassword: body.querySelector('#a-current').value,
        newPassword: body.querySelector('#a-new').value,
      });
      toast('Senha alterada.', 'success');
      return true;
    },
  });
}

/* ============================================================== navegação */

async function loadReferenceData() {
  const [{ clients }, { projects }, { users }] = await Promise.all([
    API.get('/api/clients'), API.get('/api/projects'), API.get('/api/users'),
  ]);
  state.clients = clients;
  state.projects = projects;
  state.users = users;
}

async function navigate(view) {
  if (!views[view]) view = 'lancar';
  const nav = ++navToken;
  state.view = view;
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.view === view)));
  if (location.hash.slice(1) !== view) location.hash = view;

  const root = document.getElementById('view');
  root.innerHTML = '<div class="card"><div class="empty">Carregando…</div></div>';
  try {
    await views[view](root, nav);
  } catch (err) {
    if (err.status === 401) return showLogin('Sua sessão expirou. Entre novamente.');
    if (!stillCurrent(nav)) return;   // o usuário já saiu desta tela
    root.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

function applyRoleVisibility() {
  document.querySelectorAll('[data-master]').forEach((el) => {
    el.hidden = !isMaster();
  });
}

/* ============================================================= sessão / boot */

function showLogin(message) {
  state.user = null;
  document.getElementById('app').hidden = true;
  const screen = document.getElementById('login-screen');
  screen.hidden = false;
  const alert = document.getElementById('login-alert');
  if (message) { alert.textContent = message; alert.hidden = false; }
  document.getElementById('login-email').focus();
}

async function enterApp(session) {
  state.user = session.user;
  state.firm = session.firm;
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('who-name').textContent = session.user.name;
  document.getElementById('who-role').textContent =
    session.user.role === 'master' ? 'conta master' : 'profissional';
  applyRoleVisibility();

  await loadReferenceData();

  const wanted = location.hash.slice(1);
  const allowed = isMaster()
    ? Object.keys(views)
    : ['lancar', 'meus', 'relatorios'];
  await navigate(allowed.includes(wanted) ? wanted : 'lancar');
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const alert = document.getElementById('login-alert');
  alert.hidden = true;
  const btn = event.target.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const session = await API.post('/api/auth/login', {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value,
    });
    document.getElementById('login-password').value = '';
    await enterApp(session);
  } catch (err) {
    alert.textContent = err.message;
    alert.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('tabs').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-view]');
  if (btn) navigate(btn.dataset.view);
});

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (view && view !== state.view && state.user) navigate(view);
});

document.getElementById('btn-account').addEventListener('click', accountModal);

document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await API.post('/api/auth/logout'); } catch { /* sessão já encerrada */ }
  location.hash = '';
  showLogin();
});

/* Retoma a sessão existente, se houver, ou mostra o login. */
(async function boot() {
  try {
    const session = await API.get('/api/auth/me');
    await enterApp(session);
  } catch {
    showLogin();
  }
})();
