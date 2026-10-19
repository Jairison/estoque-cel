'use strict';
/* Império Cell — Painel do Administrador (SPA por hash) */

const PAGE = 50;
const S = {
  me: null, settings: null,
  units: [], movements: [], users: [], logs: [],
  unitFilter: { q: '', model: '', storage: '', condition: '', status: 'estoque', sort: 'model' },
  unitView: 'unidades', unitPage: 1, selected: new Set(),
  mvFilter: { q: '', type: '', user: '', from: '', to: '', period: 'all' }, mvPage: 1,
  logFilter: { q: '', action: '' }, logPage: 1,
  chartKey: 'qty',
};
const ENTRY_REASONS = ['Compra', 'Troca (recebido de cliente)', 'Devolução de cliente', 'Ajuste de inventário'];

const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const compactMoney = (n) => new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 }).format(n || 0);
const luhnOk = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let d = +s[s.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
const sumBy = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
const describe = (items) => {
  const g = {};
  for (const i of items) { const k = `${i.model} ${i.storage}`; g[k] = (g[k] || 0) + 1; }
  return Object.entries(g).map(([k, n]) => `${n}× ${k}`).join(', ');
};

function mount(html) {
  const root = document.createElement('div');
  root.className = 'view-fade';
  root.innerHTML = html;
  $('#view').replaceChildren(root);
  return root;
}
const loadUnits = async () => { S.units = await api('/api/units'); };
const loadMovements = async () => { S.movements = await api('/api/movements'); };

// ═════════════════════════ Shell / roteamento ═════════════════════════
const ROUTES = {
  dashboard: { title: 'Dashboard', crumb: 'Visão geral', render: viewDashboard },
  estoque: { title: 'Aparelhos', crumb: 'Estoque', render: viewEstoque },
  entrada: { title: 'Nova entrada', crumb: 'Estoque', render: viewEntrada },
  movimentacoes: { title: 'Movimentações', crumb: 'Estoque', render: viewMovimentacoes },
  usuarios: { title: 'Usuários', crumb: 'Gestão', render: viewUsuarios },
  auditoria: { title: 'Auditoria', crumb: 'Gestão', render: viewAuditoria },
  configuracoes: { title: 'Configurações', crumb: 'Gestão', render: viewConfig },
};
const currentRoute = () => location.hash.replace(/^#\/?/, '') || 'dashboard';

async function router() {
  const name = ROUTES[currentRoute()] ? currentRoute() : 'dashboard';
  const r = ROUTES[name];
  $$('#nav [data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $('#pageTitle').textContent = r.title;
  $('#crumb').textContent = r.crumb;
  document.title = `${r.title} · ${S.settings.storeName}`;
  closeSidebar();
  $('#view').innerHTML = `<div class="kpis">${'<div class="card skeleton" style="height:128px"></div>'.repeat(4)}</div><div class="card skeleton" style="height:340px"></div>`;
  try { await r.render(); } catch (err) {
    mount(`<div class="card empty"><div class="empty-ico">${icon('alert')}</div><h4>Não foi possível carregar</h4><p>${esc(err.message)}</p></div>`);
  }
}
const rerender = () => router();

function closeSidebar() { $('#sidebar').classList.remove('open'); $('.sidebar-scrim')?.remove(); }

async function boot() {
  hydrateIcons();
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#logoutBtn').addEventListener('click', logout);
  $('#quickIn').addEventListener('click', () => { location.hash = '#/entrada'; });
  $('#quickOut').addEventListener('click', () => quickOut());
  document.addEventListener('password-changed', () => { S.me.defaultPassword = false; });
  $('#menuBtn').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    const scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    scrim.addEventListener('click', closeSidebar);
    document.body.append(scrim);
  });
  try {
    const [me, settings] = await Promise.all([api('/api/me'), api('/api/settings')]);
    S.me = me.user; S.settings = settings;
  } catch { return; }
  renderShell();
  window.addEventListener('hashchange', router);
  router();
  refreshLowBadge();
  refreshPendingBadge();
}

function renderShell() {
  $('#userName').textContent = S.me.name;
  $('#avatar').textContent = initials(S.me.name);
  $('[data-store]').innerHTML = brandHtml(S.settings.storeName);
}

async function refreshLowBadge(count) {
  if (count === undefined) { try { count = (await api('/api/dashboard')).lowStock.length; } catch { return; } }
  const el = $('#lowCount');
  el.textContent = count;
  el.title = `${count} modelo(s) com estoque baixo`;
  el.classList.toggle('hidden', !count);
}

async function quickOut(preset) {
  try {
    const summary = await api('/api/stock/summary');
    openSaidaWizard({ groups: summary.groups, settings: S.settings, preset: preset || {}, onDone: () => { rerender(); refreshLowBadge(); } });
  } catch (err) { toast(err.message, 'error'); }
}

// Avisos de proteção dos dados (backup em dia e mais de um administrador)
function safetyBanners(d) {
  const out = [];
  const days = d.lastBackupAt ? Math.floor((Date.now() - new Date(d.lastBackupAt)) / 864e5) : null;
  if (days === null || days >= 7) {
    out.push(`<div class="banner" data-safety>${icon('database')}<div class="grow"><strong>${days === null ? 'Nenhum backup feito ainda.' : `Último backup há ${days} dias.`}</strong> Baixe uma cópia de segurança do estoque toda semana e guarde fora do computador (Google Drive, pen drive, e-mail).</div><button class="btn btn-sm" data-do-backup data-loading="Gerando...">Fazer backup agora</button></div>`);
  }
  if (d.activeAdmins === 1) {
    out.push(`<div class="banner" data-safety>${icon('shield')}<div class="grow"><strong>Só existe um administrador.</strong> Se você perder o acesso ao seu e-mail, ninguém mais consegue administrar o sistema. Cadastre um segundo administrador de confiança.</div><a class="btn btn-sm" href="#/usuarios">Cadastrar</a></div>`);
  }
  return out.join('');
}
async function downloadBackup(btn, photos = false) {
  const data = await withLoading(btn, () => api('/api/backup', { body: { photos } }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `backup-estoque-${localDay(new Date())}${photos ? '-com-fotos' : ''}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Backup baixado: ${plural(data.units.length, 'aparelho', 'aparelhos')}, ${plural(data.movements.length, 'movimentação', 'movimentações')}. Guarde o arquivo em local seguro.`);
}

function defaultPwBanner() {
  if (!S.me.defaultPassword) return '';
  return `<div class="banner" data-default-pw>${icon('alert')}<div class="grow"><strong>Senha padrão em uso.</strong> Altere a senha do administrador para proteger o sistema.</div><button class="btn btn-sm" data-change-pw>Alterar senha</button></div>`;
}

// ═════════════════════════ Dashboard ═════════════════════════
async function viewDashboard() {
  const d = await api('/api/dashboard');
  refreshLowBadge(d.lowStock.length);
  const margin = d.month.value ? (d.month.profit / d.month.value) * 100 : 0;
  const root = mount(`
    ${defaultPwBanner()}
    ${safetyBanners(d)}
    <div class="kpis">
      <div class="card kpi hero">
        <div class="k-top"><span class="k-label">Aparelhos em estoque</span><span class="k-ico">${icon('box')}</span></div>
        <div class="k-value">${fmtInt(d.inStock)}</div>
        <div class="k-foot"><span class="badge green">${d.available} disponíveis</span>${d.reserved ? `<span class="badge blue">${d.reserved} reserv.</span>` : ''}${d.maintenance ? `<span class="badge orange">${d.maintenance} manut.</span>` : ''}</div>
      </div>
      <div class="card kpi">
        <div class="k-top"><span class="k-label">Valor do estoque (venda)</span><span class="k-ico">${icon('wallet')}</span></div>
        <div class="k-value">${fmtMoney(d.stockValue)}</div>
        <div class="k-foot">Custo investido: <b class="text-2">${fmtMoney(d.stockCost)}</b></div>
      </div>
      <div class="card kpi">
        <div class="k-top"><span class="k-label">Faturamento do mês</span><span class="k-ico">${icon('trend')}</span></div>
        <div class="k-value">${fmtMoney(d.month.value)}</div>
        <div class="k-foot">${plural(d.month.qty, 'aparelho', 'aparelhos')} · lucro <b style="color:var(--green)">${fmtMoney(d.month.profit)}</b> (${margin.toFixed(1)}%)</div>
      </div>
      <div class="card kpi">
        <div class="k-top"><span class="k-label">Saídas hoje</span><span class="k-ico">${icon('out')}</span></div>
        <div class="k-value">${fmtInt(d.today.qty)}</div>
        <div class="k-foot">${fmtMoney(d.today.value)} em vendas hoje</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <div><h3>Saídas nos últimos 30 dias</h3><p>${plural(sumBy(d.series, (s) => s.qty), 'aparelho', 'aparelhos')} · ${fmtMoney(sumBy(d.series, (s) => s.value))}</p></div>
          <div class="seg" data-chart-seg>
            <button class="${S.chartKey === 'qty' ? 'active' : ''}" data-key="qty">Unidades</button>
            <button class="${S.chartKey === 'value' ? 'active' : ''}" data-key="value">Valor</button>
          </div>
        </div>
        <div class="card-body" data-chart>${barChart(d.series, S.chartKey)}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Disponíveis por modelo</h3><p>Top ${Math.min(8, d.byModel.length)} modelos</p></div><a class="btn btn-sm btn-ghost" href="#/estoque">Ver tudo ${icon('chevronRight')}</a></div>
        <div class="card-body">${hbars(d.byModel.slice(0, 8))}</div>
      </div>
    </div>

    <div class="grid-3">
      <div class="card">
        <div class="card-head"><div><h3>Por capacidade</h3><p>Aparelhos disponíveis</p></div></div>
        <div class="card-body">${donut(d.byStorage)}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Estoque baixo</h3><p>≤ ${d.lowStockLimit} unidades disponíveis</p></div>${d.lowStock.length ? `<span class="badge orange">${d.lowStock.length}</span>` : ''}</div>
        <div class="list" style="max-height:290px;overflow:auto">
          ${d.lowStock.length ? d.lowStock.map((l) => `
            <div class="list-item">
              <div class="phone-ico" style="${l.qty === 0 ? 'background:var(--red-soft);color:var(--red)' : 'background:var(--orange-soft);color:var(--orange)'}">${icon(l.qty === 0 ? 'alert' : 'phone')}</div>
              <div class="grow"><strong>${esc(l.model)}</strong><small>${esc(l.storage)}</small></div>
              <span class="badge ${l.qty === 0 ? 'red' : 'orange'}">${l.qty === 0 ? 'Esgotado' : `${l.qty} un.`}</span>
            </div>`).join('') : emptyBlock('check', 'Tudo em ordem', 'Nenhum modelo com estoque baixo.')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Ranking do mês</h3><p>Saídas por usuário</p></div></div>
        <div class="list">
          ${d.sellers.length ? d.sellers.slice(0, 6).map((s, i) => `
            <div class="list-item">
              <div class="avatar ${i ? 'violet' : ''}">${i === 0 ? icon('crown') : initials(s.name)}</div>
              <div class="grow"><strong>${esc(s.name)}</strong><small>${fmtMoney(s.value)}</small></div>
              <b class="num">${s.qty}</b>
            </div>`).join('') : emptyBlock('users', 'Sem saídas no mês', 'O ranking aparece após as primeiras vendas.')}
        </div>
        ${d.topModels.length ? `<div class="card-body" style="border-top:1px solid var(--border)"><div class="label" style="margin-bottom:10px">Mais vendidos no mês</div><div class="chips">${d.topModels.map((t) => `<span class="badge plain gold">${esc(t.key)} · ${t.qty}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Movimentações recentes</h3><p>Últimos registros de entrada, saída e estorno</p></div><a class="btn btn-sm" href="#/movimentacoes">Ver histórico ${icon('chevronRight')}</a></div>
      <div class="list">${d.recent.length ? d.recent.map(mvListItem).join('') : emptyBlock('swap', 'Nenhuma movimentação', 'Cadastre uma entrada para começar.')}</div>
    </div>
  `);

  root.querySelector('[data-change-pw]')?.addEventListener('click', openChangePassword);
  root.querySelector('[data-do-backup]')?.addEventListener('click', async (e) => {
    try { await downloadBackup(e.currentTarget); rerender(); } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-chart-seg]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    S.chartKey = b.dataset.key;
    $$('[data-key]', root).forEach((x) => x.classList.toggle('active', x === b));
    $('[data-chart]', root).innerHTML = barChart(d.series, S.chartKey);
  });
  bindChartTips(root);
}

function emptyBlock(ic, title, text) {
  return `<div class="empty" style="padding:36px 20px"><div class="empty-ico">${icon(ic)}</div><h4>${esc(title)}</h4><p>${esc(text)}</p></div>`;
}

function mvListItem(m) {
  const t = MV_TYPE[m.type] || MV_TYPE.saida;
  return `<div class="list-item">
    <div class="mv-ico ${m.type}">${icon(t.icon)}</div>
    <div class="grow"><strong>${esc(describe(m.items))}</strong><small>${t.label} · ${esc(m.reason)}${m.customer ? ` · ${esc(m.customer)}` : ''} · ${esc(m.userName)} · ${fmtRelative(m.at)}</small></div>
    ${m.reverted ? '<span class="badge violet">Estornada</span>' : m.type !== 'estorno' ? `<b class="num hide-sm">${fmtMoney(m.value)}</b>` : ''}
  </div>`;
}

// ── Gráficos (SVG puro)
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function barChart(series, key) {
  const W = 720, H = 240, pl = 52, pr = 6, pt = 12, pb = 26;
  const max = Math.max(...series.map((s) => s[key]), 0);
  const step = Math.max(key === 'qty' ? 1 : 100, niceStep(Math.max(max, 1) / 4));
  const top = Math.max(step, step * Math.ceil(max / step));
  const iw = W - pl - pr, ih = H - pt - pb, bw = iw / series.length;
  const fmt = (v) => (key === 'value' ? compactMoney(v) : fmtInt(v));
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de saídas">
    <defs><linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d98f"/><stop offset="1" stop-color="#a8822e"/></linearGradient></defs>`;
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = pt + ih - (v / top) * ih;
    out += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="axis-label" x="${pl - 8}" y="${y + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }
  series.forEach((s, i) => {
    const v = s[key];
    const h = v > 0 ? Math.max(3, (v / top) * ih) : 0;
    const x = pl + i * bw;
    const [yy, mm, dd] = s.day.split('-');
    out += `<g class="col" data-tip="${esc(`${dd}/${mm}/${yy}`)}" data-qty="${s.qty}" data-value="${s.value}">
      <rect class="bar-bg" x="${x + 1}" y="${pt}" width="${bw - 2}" height="${ih}" rx="4"/>
      ${h ? `<rect class="bar" x="${x + bw * 0.2}" y="${pt + ih - h}" width="${bw * 0.6}" height="${h}" rx="3"/>` : ''}
    </g>`;
    if (i % 5 === 4 || i === 0) out += `<text class="axis-label" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${dd}/${mm}</text>`;
  });
  return out + '</svg>';
}

function bindChartTips(root) {
  let tip;
  root.addEventListener('mousemove', (e) => {
    const g = e.target.closest('g.col');
    if (!g) { tip?.remove(); tip = null; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.append(tip); }
    tip.innerHTML = `<strong>${plural(+g.dataset.qty, 'aparelho', 'aparelhos')}</strong><span class="muted">${fmtMoney(+g.dataset.value)} · ${g.dataset.tip}</span>`;
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY}px`;
  });
  root.addEventListener('mouseleave', () => { tip?.remove(); tip = null; });
  window.addEventListener('hashchange', () => { tip?.remove(); tip = null; }, { once: true });
}

function hbars(rows) {
  if (!rows.length) return emptyBlock('box', 'Sem aparelhos disponíveis', 'Cadastre uma entrada.');
  const max = Math.max(...rows.map((r) => r.qty));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar"><span class="name" title="${esc(r.key)}">${esc(r.key)}</span><div class="track"><div class="fill" style="width:${(r.qty / max) * 100}%"></div></div><span class="val">${r.qty}</span></div>`).join('')}</div>`;
}

const PALETTE = ['#d9b45a', '#7b6cff', '#3ea6ff', '#32d27a', '#ff9f2e', '#ff5a8a', '#9aa0a6', '#5ad1c8'];
function donut(rows) {
  if (!rows.length) return emptyBlock('database', 'Sem dados', 'Nenhum aparelho disponível.');
  const sRank = storageRank(S.settings.storages);
  rows = rows.slice().sort((a, b) => sRank(a.key) - sRank(b.key));
  const total = sumBy(rows, (r) => r.qty);
  const r = 58, C = 2 * Math.PI * r;
  let off = 0;
  const segs = rows.map((row, i) => {
    const len = (row.qty / total) * C;
    const s = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`;
    off += len;
    return s;
  }).join('');
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 150 150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="16"/>${segs}
      <text x="75" y="72" text-anchor="middle" font-size="26" font-weight="800">${total}</text><text x="75" y="92" text-anchor="middle" font-size="10" fill="var(--muted)" style="fill:var(--muted)">UNIDADES</text></svg>
    <div class="legend">${rows.map((row, i) => `<div><i style="background:${PALETTE[i % PALETTE.length]}"></i><span>${esc(row.key)}</span><b>${row.qty}</b></div>`).join('')}</div>
  </div>`;
}

// ═════════════════════════ Estoque (aparelhos) ═════════════════════════
async function viewEstoque() {
  await Promise.all([loadUnits(), loadMovements()]);
  const f = S.unitFilter;
  const mRank = modelRank(S.settings.models);
  const sRank = storageRank(S.settings.storages);
  const models = [...new Set([...S.settings.models, ...S.units.map((u) => u.model)])].filter((m) => S.units.some((u) => u.model === m)).sort((a, b) => mRank(a) - mRank(b));
  const storages = [...new Set(S.units.map((u) => u.storage))].sort((a, b) => sRank(a) - sRank(b));
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;

  const root = mount(`
    <div class="page-head">
      <div><h2>Aparelhos</h2><p>Gerencie cada iPhone do estoque — preço, status, IMEI e histórico.</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-export>${icon('download')}Exportar CSV</button>
        <a class="btn btn-primary" href="#/entrada">${icon('plus')}Nova entrada</a>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-icon grow">${icon('search')}<input class="input" data-f="q" placeholder="Buscar por modelo, cor, fornecedor ou IMEI (pode usar o leitor)…" value="${esc(f.q)}"></div>
        <select class="select" data-f="model">${opt('', 'Todos os modelos', f.model)}${models.map((m) => opt(m, m, f.model)).join('')}</select>
        <select class="select" data-f="storage">${opt('', 'Capacidade', f.storage)}${storages.map((s) => opt(s, s, f.storage)).join('')}</select>
        <select class="select" data-f="condition">${opt('', 'Condição', f.condition)}${S.settings.conditions.map((c) => opt(c, c, f.condition)).join('')}</select>
        <select class="select" data-f="status">
          ${opt('estoque', 'Em estoque', f.status)}${opt('disponivel', 'Disponíveis', f.status)}${opt('reservado', 'Reservados', f.status)}${opt('manutencao', 'Em manutenção', f.status)}${opt('saida', 'Já saíram', f.status)}${opt('', 'Todos', f.status)}${opt('excluido', '🗑 Lixeira', f.status)}
        </select>
        <select class="select" data-f="sort">
          ${opt('model', 'Ordenar: modelo', f.sort)}${opt('new', 'Mais recentes', f.sort)}${opt('old', 'Mais antigos', f.sort)}${opt('priceDesc', 'Maior preço', f.sort)}${opt('priceAsc', 'Menor preço', f.sort)}
        </select>
        <div class="seg" data-view-seg>
          <button class="${S.unitView === 'unidades' ? 'active' : ''}" data-view="unidades">${icon('phone')}Unidades</button>
          <button class="${S.unitView === 'resumo' ? 'active' : ''}" data-view="resumo">${icon('grid')}Resumo</button>
        </div>
      </div>
      <div data-region></div>
    </div>
    <div data-bulk></div>
  `);

  let t;
  root.addEventListener('input', (e) => {
    if (e.target.dataset.f !== 'q') return;
    clearTimeout(t);
    t = setTimeout(() => { f.q = e.target.value.trim(); S.unitPage = 1; renderUnits(root); }, 160);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.dataset.f !== 'q') return;
    clearTimeout(t);
    f.q = e.target.value.trim(); S.unitPage = 1; renderUnits(root);
  });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (k && k !== 'q') { f[k] = e.target.value; S.unitPage = 1; renderUnits(root); }
    if (e.target.matches('[data-sel]')) {
      const id = e.target.closest('tr').dataset.id;
      e.target.checked ? S.selected.add(id) : S.selected.delete(id);
      e.target.closest('tr').classList.toggle('selected', e.target.checked);
      renderBulk(root);
    }
    if (e.target.matches('[data-sel-all]')) {
      const ids = $$('tbody tr[data-id]', root).map((tr) => tr.dataset.id);
      ids.forEach((id) => (e.target.checked ? S.selected.add(id) : S.selected.delete(id)));
      renderUnits(root);
    }
    if (e.target.matches('[data-bulk-status]') && e.target.value) bulk('status', e.target.value, root);
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-open]');
    if (!b) return;
    if (b.matches('[data-show-noimei]')) {
      Object.assign(f, { q: 'sem imei', model: '', storage: '', condition: '', status: 'estoque' });
      S.unitView = 'unidades'; S.unitPage = 1;
      return viewEstoque();
    }
    if (b.dataset.view) { S.unitView = b.dataset.view; $$('[data-view]', root).forEach((x) => x.classList.toggle('active', x === b)); renderUnits(root); }
    else if (b.dataset.page) { S.unitPage += Number(b.dataset.page); renderUnits(root); }
    else if (b.matches('[data-export]')) exportUnits();
    else if (b.dataset.act) {
      const u = S.units.find((x) => x.id === b.closest('tr').dataset.id);
      if (b.dataset.act === 'edit') openUnitForm(u, () => renderUnits(root));
      if (b.dataset.act === 'view') openUnitDetails(u);
      if (b.dataset.act === 'out') openAdminOut([u], () => renderUnits(root));
      if (b.dataset.act === 'del') deleteUnit(u, root);
      if (b.dataset.act === 'restore') restoreUnit(u, root);
    }
    else if (b.dataset.open) { f.model = b.dataset.model; f.storage = b.dataset.storage; S.unitView = 'unidades'; viewEstoque(); }
    else if (b.dataset.bulk) {
      const act = b.dataset.bulk;
      if (act === 'clear') { S.selected.clear(); renderUnits(root); }
      if (act === 'delete') bulk('delete', null, root);
      if (act === 'price') bulkPrice(root);
      if (act === 'out') {
        const units = S.units.filter((u) => S.selected.has(u.id) && u.status !== 'saida');
        if (!units.length) return toast('Nenhum aparelho selecionado está em estoque.', 'error');
        openAdminOut(units, () => { S.selected.clear(); renderUnits(root); });
      }
    }
  });
  renderUnits(root);
}

// Texto buscado é um IMEI? (só dígitos, espaços, pontos ou traços — no mínimo 4 dígitos)
const imeiQuery = (q) => (/^[\d\s.\-]+$/.test(q) && q.replace(/\D/g, '').length >= 4 ? q.replace(/\D/g, '') : '');

function filteredUnits() {
  const f = S.unitFilter;
  const q = f.q.toLowerCase();
  const qd = q.replace(/\D/g, '');
  const imeiQ = imeiQuery(q);
  const mRank = modelRank(S.settings.models);
  const sRank = storageRank(S.settings.storages);
  const sorts = {
    model: (a, b) => mRank(b.model) - mRank(a.model) || sRank(a.storage) - sRank(b.storage) || a.color.localeCompare(b.color) || a.createdAt.localeCompare(b.createdAt),
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    old: (a, b) => a.createdAt.localeCompare(b.createdAt),
    priceDesc: (a, b) => b.price - a.price,
    priceAsc: (a, b) => a.price - b.price,
  };
  if (imeiQ) return S.units.filter((u) => u.imei.includes(imeiQ)).sort(sorts.new);
  return S.units.filter((u) => {
    if (f.status === 'excluido') { if (u.status !== 'excluido') return false; }
    else if (u.status === 'excluido') return false; // a lixeira só aparece no filtro "Lixeira"
    else if (f.status === 'estoque') { if (u.status === 'saida') return false; }
    else if (f.status && u.status !== f.status) return false;
    if (f.model && u.model !== f.model) return false;
    if (f.storage && u.storage !== f.storage) return false;
    if (f.condition && u.condition !== f.condition) return false;
    if (q === 'sem imei') return !u.imei;
    if (q) {
      const hay = `${u.model} ${u.storage} ${u.color} ${u.condition} ${u.supplier} ${u.note}`.toLowerCase();
      if (!hay.includes(q) && !(qd.length >= 3 && u.imei.includes(qd))) return false;
    }
    return true;
  }).sort(sorts[f.sort] || sorts.model);
}

function renderUnits(root) {
  const list = filteredUnits();
  const region = $('[data-region]', root);
  const stats = `<div class="stat-row">
    <span>Aparelhos<b>${fmtInt(list.length)}</b></span>
    <span>Custo total<b>${fmtMoney(sumBy(list, (u) => u.cost))}</b></span>
    <span>Valor de venda<b>${fmtMoney(sumBy(list, (u) => u.price))}</b></span>
    <span>Lucro potencial<b style="color:var(--green)">${fmtMoney(sumBy(list, (u) => u.price - u.cost))}</b></span>
  </div>`;

  const imeiQ = imeiQuery(S.unitFilter.q);
  const noImei = S.units.filter((u) => !u.imei && u.status !== 'saida').length;
  const imeiNote = imeiQ ? `<div class="banner" style="margin:14px 22px 0;background:var(--blue-soft);border-color:transparent">${icon('barcode')}
    <div class="grow">Buscando o IMEI <b class="mono">${esc(imeiQ)}</b> em <b>todos os aparelhos</b>, inclusive os que já saíram (os outros filtros são ignorados).</div></div>` : '';

  if (!list.length) {
    region.innerHTML = stats + imeiNote + (imeiQ
      ? `<div class="empty"><div class="empty-ico">${icon('barcode')}</div><h4>Nenhum aparelho com este IMEI</h4>
          <p>Confira os dígitos.${noImei ? ` Há <b>${noImei}</b> aparelho(s) em estoque cadastrados <b>sem IMEI</b>. Eles não aparecem na busca por IMEI até que o IMEI seja adicionado.` : ''}</p>
          ${noImei ? `<button class="btn btn-sm" data-show-noimei style="margin-top:14px">${icon('eye')}Ver aparelhos sem IMEI</button>` : ''}</div>`
      : emptyBlock(S.units.length ? 'search' : 'box', S.units.length ? 'Nenhum aparelho encontrado' : 'Estoque vazio', S.units.length ? 'Ajuste os filtros de busca.' : 'Cadastre a primeira entrada de iPhones.'));
    renderBulk(root);
    return;
  }

  if (S.unitView === 'resumo') {
    const g = new Map();
    for (const u of list) {
      const k = `${u.model}|${u.storage}`;
      if (!g.has(k)) g.set(k, { model: u.model, storage: u.storage, disponivel: 0, reservado: 0, manutencao: 0, saida: 0, cost: 0, price: 0, n: 0 });
      const x = g.get(k);
      x[u.status]++; x.cost += u.cost; x.price += u.price; x.n++;
    }
    const low = S.settings.lowStock;
    region.innerHTML = stats + `<div class="table-wrap"><table class="table">
      <thead><tr><th>Modelo</th><th class="center">Disponível</th><th class="center">Reservado</th><th class="center">Manutenção</th>${S.unitFilter.status === 'saida' || !S.unitFilter.status ? '<th class="center">Saíram</th>' : ''}<th class="right">Custo médio</th><th class="right">Preço médio</th><th class="right">Valor total</th><th></th></tr></thead>
      <tbody>${[...g.values()].map((x) => `<tr>
        <td><div class="cell-model"><div class="phone-ico">${icon('phone')}</div><div><strong>${esc(x.model)}</strong><small>${esc(x.storage)}</small></div></div></td>
        <td class="center"><span class="badge ${x.disponivel <= low ? 'orange' : 'green'}">${x.disponivel}</span></td>
        <td class="center num">${x.reservado || '<span class="muted">—</span>'}</td>
        <td class="center num">${x.manutencao || '<span class="muted">—</span>'}</td>
        ${S.unitFilter.status === 'saida' || !S.unitFilter.status ? `<td class="center num">${x.saida || '<span class="muted">—</span>'}</td>` : ''}
        <td class="right num">${fmtMoney(x.cost / x.n)}</td>
        <td class="right num">${fmtMoney(x.price / x.n)}</td>
        <td class="right num"><strong>${fmtMoney(x.price)}</strong></td>
        <td><div class="actions"><button class="btn btn-sm btn-ghost" data-open="1" data-model="${esc(x.model)}" data-storage="${esc(x.storage)}">Ver unidades ${icon('chevronRight')}</button></div></td>
      </tr>`).join('')}</tbody></table></div>`;
    renderBulk(root);
    return;
  }

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  S.unitPage = Math.min(Math.max(1, S.unitPage), pages);
  const pageItems = list.slice((S.unitPage - 1) * PAGE, S.unitPage * PAGE);
  const allSel = pageItems.every((u) => S.selected.has(u.id));

  region.innerHTML = stats + imeiNote + `<div class="table-wrap"><table class="table">
    <thead><tr>
      <th class="center" style="width:40px"><input type="checkbox" class="check-input" data-sel-all ${allSel ? 'checked' : ''} aria-label="Selecionar página"></th>
      <th>Aparelho</th><th>Condição</th><th>Bateria</th><th>IMEI</th><th class="right">Custo</th><th class="right">Venda</th><th class="right">Margem</th><th>Status</th><th>Entrada</th><th></th>
    </tr></thead>
    <tbody>${pageItems.map(unitRow).join('')}</tbody>
  </table></div>
  ${pages > 1 ? `<div class="pager"><span>Mostrando ${(S.unitPage - 1) * PAGE + 1}–${Math.min(S.unitPage * PAGE, list.length)} de ${list.length}</span>
    <div style="display:flex;gap:6px"><button class="btn btn-sm" data-page="-1" ${S.unitPage === 1 ? 'disabled' : ''}>${icon('chevronLeft')}</button><span style="align-self:center">${S.unitPage} / ${pages}</span><button class="btn btn-sm" data-page="1" ${S.unitPage === pages ? 'disabled' : ''}>${icon('chevronRight')}</button></div></div>` : ''}`;
  renderBulk(root);
}

function unitRow(u) {
  const margin = u.price > 0 && u.cost > 0 ? ((u.price - u.cost) / u.price) * 100 : null;
  const sel = S.selected.has(u.id);
  const st = STATUS[u.status] || STATUS.disponivel;
  if (u.status === 'excluido') return `<tr class="dim" data-id="${esc(u.id)}">
    <td></td>
    <td><div class="cell-model"><div class="phone-ico">${icon('trash')}</div><div><strong>${esc(u.model)} · ${esc(u.storage)}</strong><small>${esc(u.color)}</small></div></div></td>
    <td>${conditionBadge(u.condition)}</td><td></td>
    <td class="mono">${u.imei ? esc(fmtImei(u.imei)) : '<span class="muted">—</span>'}</td>
    <td class="right num">${fmtMoney(u.cost)}</td><td class="right num">${fmtMoney(u.price)}</td><td></td>
    <td><span class="badge red">Na lixeira</span></td>
    <td class="muted" title="Excluído por ${esc(u.deletedBy || '—')}">${fmtDate(u.deletedAt)}</td>
    <td><div class="actions">
      <button class="btn btn-ghost btn-icon btn-sm" data-act="view" title="Detalhes e histórico">${icon('eye')}</button>
      <button class="btn btn-sm" data-act="restore" title="Devolver para o estoque">${icon('undo')}Restaurar</button>
    </div></td>
  </tr>`;
  return `<tr class="${sel ? 'selected' : ''} ${u.status === 'saida' ? 'dim' : ''}" data-id="${esc(u.id)}">
    <td class="center"><input type="checkbox" class="check-input" data-sel ${sel ? 'checked' : ''} aria-label="Selecionar"></td>
    <td><div class="cell-model"><div class="phone-ico">${icon('phone')}</div><div><strong>${esc(u.model)} · ${esc(u.storage)}</strong><small>${esc(u.color)}</small></div></div></td>
    <td>${conditionBadge(u.condition)}</td>
    <td class="num">${u.battery != null ? `<span style="color:${u.battery < 80 ? 'var(--orange)' : 'inherit'}">${u.battery}%</span>` : '<span class="muted">—</span>'}</td>
    <td class="mono">${u.imei ? esc(fmtImei(u.imei)) : u.status === 'saida' ? '<span class="muted">—</span>' : `<button class="btn btn-ghost btn-sm" data-act="edit" title="Este aparelho foi cadastrado sem IMEI" style="color:var(--gold);height:26px;padding:0 8px">${icon('plus')}IMEI</button>`}</td>
    <td class="right num">${fmtMoney(u.cost)}</td>
    <td class="right num"><strong>${fmtMoney(u.price)}</strong></td>
    <td class="right num">${margin == null ? '<span class="muted">—</span>' : `<span style="color:${margin >= 0 ? 'var(--green)' : 'var(--red)'}">${margin.toFixed(1)}%</span>`}</td>
    <td><span class="badge ${st.cls}">${st.label}</span></td>
    <td class="muted" title="${fmtDateTime(u.createdAt)}">${fmtDate(u.createdAt)}</td>
    <td><div class="actions">
      ${u.status === 'disponivel' ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="out" title="Dar saída">${icon('out')}</button>` : ''}
      <button class="btn btn-ghost btn-icon btn-sm" data-act="view" title="Detalhes e histórico">${icon('eye')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" title="Editar">${icon('edit')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="del" title="Mover para a lixeira">${icon('trash')}</button>
    </div></td>
  </tr>`;
}

function renderBulk(root) {
  const box = $('[data-bulk]', root);
  // remove seleções que não existem mais
  for (const id of S.selected) if (!S.units.some((u) => u.id === id)) S.selected.delete(id);
  const n = S.selected.size;
  if (!n) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="bulkbar">
    <strong>${plural(n, 'selecionado', 'selecionados')}</strong>
    <button class="btn btn-sm btn-primary" data-bulk="out">${icon('out')}Dar saída</button>
    <select class="select" data-bulk-status style="height:32px;width:auto;font-size:12.5px">
      <option value="">Alterar status…</option><option value="disponivel">Disponível</option><option value="reservado">Reservado</option><option value="manutencao">Manutenção</option>
    </select>
    <button class="btn btn-sm" data-bulk="price">${icon('tag')}Preço</button>
    <button class="btn btn-sm btn-danger" data-bulk="delete">${icon('trash')}Excluir</button>
    <button class="btn btn-sm btn-ghost" data-bulk="clear">${icon('x')}Limpar</button>
  </div>`;
}

async function bulk(action, value, root) {
  const ids = [...S.selected];
  if (action === 'delete') {
    const ok = await confirmDialog({ title: `Mover ${plural(ids.length, 'aparelho', 'aparelhos')} para a lixeira?`, message: 'Os aparelhos saem do estoque, mas <b>nada é apagado</b>: você pode restaurá-los a qualquer momento pelo filtro <b>🗑 Lixeira</b>. O histórico é preservado.', confirmText: 'Mover para a lixeira', danger: true });
    if (!ok) return;
  }
  try {
    await api('/api/units/bulk', { method: 'POST', body: { ids, action, value } });
    await loadUnits();
    if (action === 'delete') S.selected.clear();
    toast(action === 'delete' ? 'Aparelhos movidos para a lixeira.' : 'Aparelhos atualizados.');
    renderUnits(root);
    refreshLowBadge();
  } catch (err) { toast(err.message, 'error'); }
}

function bulkPrice(root) {
  const m = openModal({
    size: 'sm', title: 'Alterar preço de venda', subtitle: `${plural(S.selected.size, 'aparelho selecionado', 'aparelhos selecionados')}`,
    body: `<div class="field"><label>Novo preço de venda</label><div class="input-prefix"><span>R$</span><input class="input" type="number" min="0" step="0.01" data-price autofocus></div></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>`,
  });
  m.$('[data-ok]').addEventListener('click', () => {
    const v = m.$('[data-price]').value;
    if (v === '') return toast('Informe o preço.', 'error');
    m.close();
    bulk('price', v, root);
  });
}

async function deleteUnit(u, root) {
  const ok = await confirmDialog({ title: 'Mover para a lixeira?', message: `<strong>${esc(u.model)} ${esc(u.storage)} ${esc(u.color)}</strong>${u.imei ? `<br><span class="mono">${esc(fmtImei(u.imei))}</span>` : ''}<br><br>Para registrar uma venda use “Dar saída”. A lixeira é para cadastros feitos por engano — <b>nada é apagado</b> e dá para restaurar depois.`, confirmText: 'Mover para a lixeira', danger: true });
  if (!ok) return;
  try {
    await api(`/api/units/${u.id}`, { method: 'DELETE' });
    await loadUnits();
    S.selected.delete(u.id);
    toast('Aparelho movido para a lixeira. Para desfazer, use o filtro “🗑 Lixeira”.');
    renderUnits(root);
    refreshLowBadge();
  } catch (err) { toast(err.message, 'error'); }
}

async function restoreUnit(u, root) {
  try {
    const r = await api(`/api/units/${u.id}/restore`, { method: 'POST' });
    await loadUnits();
    toast(`Aparelho restaurado (${STATUS[r.status]?.label || r.status}).`);
    renderUnits(root);
    refreshLowBadge();
  } catch (err) { toast(err.message, 'error'); }
}

function unitFormFields(u = {}) {
  const s = S.settings;
  const opts = (arr, cur) => [...new Set([...(cur && !arr.includes(cur) ? [cur] : []), ...arr])].map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  return `
    <div class="field span-2"><label>Modelo</label><select class="select" name="model" required><option value="">Selecione…</option>${opts(s.models, u.model)}</select></div>
    <div class="field"><label>Armazenamento</label><select class="select" name="storage" required><option value="">Selecione…</option>${opts(s.storages, u.storage)}</select></div>
    <div class="field"><label>Cor</label><input class="input" name="color" list="colorList" required maxlength="40" placeholder="Ex.: Titânio Natural" value="${esc(u.color || '')}"><datalist id="colorList">${s.colors.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>Condição</label><select class="select" name="condition">${s.conditions.map((c) => `<option ${c === (u.condition || 'Novo') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>Saúde da bateria</label><div class="input-prefix"><span>${icon('battery')}</span><input class="input" type="number" name="battery" min="0" max="100" placeholder="%" value="${u.battery ?? ''}"></div></div>
    <div class="field"><label>Custo (unitário)</label><div class="input-prefix"><span>R$</span><input class="input" type="number" name="cost" min="0" step="0.01" placeholder="0,00" value="${u.cost ?? ''}"></div></div>
    <div class="field"><label>Preço de venda</label><div class="input-prefix"><span>R$</span><input class="input" type="number" name="price" min="0" step="0.01" placeholder="0,00" value="${u.price ?? ''}"></div></div>
    <div class="field span-2"><label>Fornecedor</label><input class="input" name="supplier" list="supplierList" maxlength="80" placeholder="Nome do fornecedor" value="${esc(u.supplier || '')}"><datalist id="supplierList">${[...new Set(S.units.map((x) => x.supplier).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>`;
}

function openUnitForm(u, after) {
  const m = openModal({
    size: 'lg', title: 'Editar aparelho', subtitle: `Cadastrado em ${fmtDateTime(u.createdAt)} por ${esc(u.createdBy || '—')}`,
    body: `<form class="form-grid" data-form>
      ${unitFormFields(u)}
      <div class="field span-2"><label>IMEI</label>
        <div class="imei-row"><input class="input mono" name="imei" inputmode="numeric" maxlength="20" placeholder="15 dígitos" value="${esc(u.imei)}">
          <button type="button" class="btn" data-cam-edit>${icon('camera')}Câmera</button></div>
        <div data-edit-photo></div></div>
      ${u.status !== 'saida' ? `<div class="field span-2"><label>Status</label><select class="select" name="status">
        ${['disponivel', 'reservado', 'manutencao'].map((s) => `<option value="${s}" ${s === u.status ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select></div>` : ''}
      <div class="field span-all"><label>Observação</label><textarea class="textarea" name="note" maxlength="300" placeholder="Detalhes, avarias, acessórios…">${esc(u.note || '')}</textarea></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>${icon('check')}Salvar alterações</button>`,
  });
  let editPhoto = null;
  m.$('[data-cam-edit]').addEventListener('click', async () => {
    const r = await openImeiScanner({ title: `IMEI do ${u.model} ${u.storage}` });
    if (!r) return;
    m.$('[name=imei]').value = r.imei;
    editPhoto = r.photo;
    m.$('[data-edit-photo]').innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-top:8px"><img class="photo-thumb" src="${r.photo}" alt="Foto do IMEI"><span class="photo-chip">${icon('camera')}Foto salva junto ao salvar</span></div>`;
    m.$('[data-edit-photo] img').addEventListener('click', (e) => openPhotoViewer(e.target.src, `IMEI ${r.imei}`));
  });
  const save = async () => {
    const body = Object.fromEntries(new FormData(m.$('[data-form]')));
    if (editPhoto) body.photo = { imei: body.imei.replace(/\D/g, ''), image: editPhoto };
    try {
      const updated = await withLoading(m.$('[data-save]'), () => api(`/api/units/${u.id}`, { method: 'PUT', body }));
      Object.assign(u, updated);
      m.close();
      toast('Aparelho atualizado.');
      after?.();
    } catch (err) { toast(err.message, 'error'); }
  };
  m.$('[data-save]').addEventListener('click', save);
  m.$('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

function openUnitDetails(u) {
  const history = S.movements.filter((mv) => mv.unitIds?.includes(u.id)).sort((a, b) => a.at.localeCompare(b.at));
  const st = STATUS[u.status] || STATUS.disponivel;
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)"><span class="muted">${k}</span><span style="text-align:right">${v}</span></div>`;
  const md = openModal({
    size: 'lg', title: `${u.model} · ${u.storage}`, subtitle: `${esc(u.color)} · ${esc(u.condition)}`,
    body: `
      <div class="grid-2-even" style="margin-bottom:0">
        <div>
          ${row('Status', `<span class="badge ${st.cls}">${st.label}</span>`)}
          ${row('IMEI', u.imei ? `<span class="mono">${esc(fmtImei(u.imei))}</span>` : '—')}
          ${row('Bateria', u.battery != null ? `${u.battery}%` : '—')}
          ${row('Fornecedor', esc(u.supplier || '—'))}
          ${row('Entrada', fmtDateTime(u.createdAt))}
          ${u.outAt ? row('Saída', fmtDateTime(u.outAt)) : ''}
          ${u.status === 'excluido' ? row('Na lixeira desde', `${fmtDateTime(u.deletedAt)} · ${esc(u.deletedBy || '—')}${u.deletedReason ? ` · ${esc(u.deletedReason)}` : ''}`) : ''}
        </div>
        <div>
          ${row('Custo', fmtMoney(u.cost))}
          ${row('Preço de venda', `<strong>${fmtMoney(u.price)}</strong>`)}
          ${row('Lucro', `<span style="color:var(--green)">${fmtMoney(u.price - u.cost)}</span>`)}
          ${row('Cadastrado por', esc(u.createdBy || '—'))}
          ${row('Atualizado', fmtDateTime(u.updatedAt))}
          ${u.note ? row('Observação', esc(u.note)) : ''}
        </div>
      </div>
      ${u.imei ? `<div class="label" style="margin:22px 0 10px">${icon('camera')} Fotos do IMEI</div><div class="photo-grid" data-unit-photos><div class="skeleton" style="height:110px"></div></div>` : ''}
      <div class="label" style="margin:22px 0 4px">Histórico do aparelho</div>
      <div class="list" style="margin:0 -22px">${history.length ? history.map(mvListItem).join('') : '<p class="muted" style="padding:12px 22px">Sem movimentações registradas.</p>'}</div>`,
    foot: `<button class="btn" data-close>Fechar</button>`,
  });
  const grid = md.$('[data-unit-photos]');
  if (grid) {
    const KIND = { entrada: 'Entrada', saida: 'Saída', edicao: 'Cadastro do IMEI' };
    api(`/api/units/${u.id}/photos`).then((list) => {
      grid.innerHTML = list.length
        ? list.map((p) => `<figure><img src="${p.image}" alt="IMEI ${esc(p.imei)}"><figcaption>${KIND[p.kind] || 'Foto'} · ${fmtDate(p.at)}</figcaption></figure>`).join('')
        : '<p class="muted">Nenhuma foto deste aparelho ainda.</p>';
    }).catch((err) => { grid.innerHTML = `<p class="muted">${esc(err.message)}</p>`; });
    grid.addEventListener('click', (e) => { const f = e.target.closest('figure'); if (f) openPhotoViewer(f.querySelector('img').src, `IMEI ${u.imei} · ${f.querySelector('figcaption').textContent}`); });
  }
}

function openAdminOut(units, after) {
  const total = sumBy(units, (u) => u.price);
  const m = openModal({
    title: 'Registrar saída', subtitle: `${plural(units.length, 'aparelho', 'aparelhos')} · ${fmtMoney(total)}`,
    body: `
      <div class="list" style="margin:0 -24px 16px;max-height:220px;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
        ${units.map((u) => `<div class="list-item"><div class="phone-ico">${icon('phone')}</div><div class="grow"><strong>${esc(u.model)} · ${esc(u.storage)}</strong><small>${esc(u.color)}${u.imei ? ` · ${esc(fmtImei(u.imei))}` : ''}</small></div><b class="num">${fmtMoney(u.price)}</b></div>`).join('')}
      </div>
      <form class="form-grid" data-form>
        <div class="field"><label>Motivo</label><select class="select" name="reason">${S.settings.reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
        <div class="field"><label>Cliente <span class="muted">(opcional)</span></label><input class="input" name="customer" maxlength="80" placeholder="Nome do cliente"></div>
        <div class="field span-all"><label>Observação <span class="muted">(opcional)</span></label><input class="input" name="note" maxlength="300"></div>
        <div class="field span-all"><label>Foto do IMEI <span class="muted">(opcional, comprovante)</span></label>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap" data-photo-box>
            <button type="button" class="btn btn-sm" data-cam>${icon('camera')}Tirar foto do IMEI</button>
          </div>
        </div>
      </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok data-loading="Registrando...">${icon('out')}Confirmar saída</button>`,
  });
  const photos = [];
  const renderPhotos = () => {
    m.$('[data-photo-box]').innerHTML = photos.map((p, i) => `<img class="photo-thumb" src="${p.image}" alt="IMEI ${esc(p.imei)}" title="IMEI ${esc(p.imei)}" data-i="${i}">`).join('')
      + `<button type="button" class="btn btn-sm" data-cam>${icon('camera')}${photos.length ? 'Mais uma foto' : 'Tirar foto do IMEI'}</button>`;
  };
  m.$('[data-photo-box]').addEventListener('click', async (e) => {
    const img = e.target.closest('img[data-i]');
    if (img) return openPhotoViewer(img.src, img.title);
    if (!e.target.closest('[data-cam]')) return;
    const r = await openImeiScanner();
    if (!r) return;
    if (!units.some((u) => u.imei === r.imei)) toast(`Atenção: o IMEI ${r.imei} não é de nenhum aparelho desta saída.`, 'error');
    photos.push({ imei: r.imei, image: r.photo });
    renderPhotos();
  });
  m.$('[data-ok]').addEventListener('click', async (e) => {
    const body = { ...Object.fromEntries(new FormData(m.$('[data-form]'))), unitIds: units.map((u) => u.id), photos };
    try {
      const r = await withLoading(e.currentTarget, () => api('/api/stock/out', { method: 'POST', body }));
      m.close();
      toast(`Saída de ${plural(units.length, 'aparelho registrada', 'aparelhos registrada')}.`);
      if (r.photoError) toast(r.photoError, 'error');
      await Promise.all([loadUnits(), loadMovements()]);
      after?.();
      refreshLowBadge();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function exportUnits() {
  const list = filteredUnits();
  downloadCSV(`aparelhos-${localDay(new Date())}.csv`,
    ['Modelo', 'Armazenamento', 'Cor', 'Condição', 'Bateria (%)', 'IMEI', 'Custo', 'Preço de venda', 'Status', 'Fornecedor', 'Entrada', 'Saída', 'Observação'],
    list.map((u) => [u.model, u.storage, u.color, u.condition, u.battery ?? '', u.imei, String(u.cost).replace('.', ','), String(u.price).replace('.', ','), STATUS[u.status]?.label, u.supplier, fmtDateTime(u.createdAt), u.outAt ? fmtDateTime(u.outAt) : '', u.note]));
  toast(`${plural(list.length, 'aparelho exportado', 'aparelhos exportados')}.`, 'info');
}

// ═════════════════════════ Nova entrada ═════════════════════════
async function viewEntrada() {
  if (!S.units.length) await loadUnits();
  const root = mount(`
    <div class="page-head"><div><h2>Nova entrada</h2><p>Cadastre iPhones recebidos — individualmente por IMEI ou em lote por quantidade.</p></div></div>
    <div class="grid-2" style="align-items:start">
      <form class="card" data-form novalidate>
        <div class="card-head"><div><h3>Dados do aparelho</h3><p>Todos os aparelhos deste lote compartilham estas informações.</p></div></div>
        <div class="card-body form-grid">
          ${unitFormFields({})}
          <div class="field span-2"><label>Origem da entrada</label><select class="select" name="reason">${ENTRY_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
          <div class="field span-all"><label>Observação</label><input class="input" name="note" maxlength="300" placeholder="Opcional — nota fiscal, acessórios inclusos…"></div>
        </div>
        <div class="card-head" style="border-top:1px solid var(--border)">
          <div><h3>Identificação</h3><p>Recomendado: um IMEI por aparelho, para rastrear cada unidade.</p></div>
          <div class="seg" data-mode-seg>
            <button type="button" class="active" data-mode="imei">${icon('barcode')}Por IMEI</button>
            <button type="button" data-mode="qty">${icon('box')}Por quantidade</button>
          </div>
        </div>
        <div class="card-body">
          <div data-imei-box class="field">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <label>IMEIs <span class="muted">(um por linha — câmera, leitor de código de barras ou digitação)</span></label>
              <button type="button" class="btn btn-sm btn-primary" data-cam-entry>${icon('camera')}Escanear pela câmera</button>
            </div>
            <textarea class="textarea mono" name="imeis" rows="6" placeholder="356789012345678&#10;356789012345679"></textarea>
            <div class="imei-status" data-imei-status></div>
            <div class="photo-strip" data-entry-photos></div>
          </div>
          <div data-qty-box class="field hidden" style="max-width:220px">
            <label>Quantidade</label>
            <input class="input" type="number" name="qty" min="1" max="500" value="1">
          </div>
        </div>
        <div class="card-body" style="border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px">
          <button type="reset" class="btn btn-ghost">Limpar</button>
          <button type="submit" class="btn btn-primary btn-lg" data-submit data-loading="Cadastrando...">${icon('check')}Cadastrar entrada</button>
        </div>
      </form>

      <div class="card side-card" style="top:96px">
        <div class="card-head"><div><h3>Resumo do lote</h3><p>Atualizado em tempo real</p></div></div>
        <div class="card-body" data-summary></div>
      </div>
    </div>
  `);

  const form = $('[data-form]', root);
  let mode = 'imei';
  const entryPhotos = new Map(); // IMEI → foto tirada na leitura pela câmera

  // Miniaturas das fotos (só dos IMEIs que continuam na lista)
  const renderEntryPhotos = () => {
    const listed = new Set(parseImeis());
    for (const k of entryPhotos.keys()) if (!listed.has(k)) entryPhotos.delete(k);
    $('[data-entry-photos]', root).innerHTML = [...entryPhotos].map(([imei, photo]) => `
      <figure data-imei="${esc(imei)}"><img src="${photo}" alt="IMEI ${esc(imei)}" title="IMEI ${esc(imei)}">
        <figcaption>${esc(imei.slice(-4))}</figcaption>
        <button type="button" data-rm-photo title="Remover foto" aria-label="Remover foto">${icon('x')}</button></figure>`).join('');
  };
  $('[data-entry-photos]', root).addEventListener('click', (e) => {
    const fig = e.target.closest('figure');
    if (!fig) return;
    if (e.target.closest('[data-rm-photo]')) { entryPhotos.delete(fig.dataset.imei); renderEntryPhotos(); return; }
    openPhotoViewer(fig.querySelector('img').src, `IMEI ${fig.dataset.imei}`);
  });
  $('[data-cam-entry]', root).addEventListener('click', async () => {
    let added = 0;
    await openImeiScanner({
      title: 'Escanear IMEIs da entrada',
      continuous: true,
      onScan: ({ imei, photo }) => {
        if (parseImeis().includes(imei)) return `O IMEI ${imei} já está na lista.`;
        if (S.units.some((u) => u.imei === imei && u.status !== 'saida')) return `O IMEI ${imei} já está cadastrado no estoque.`;
        const cur = form.imeis.value.replace(/\s+$/, '');
        form.imeis.value = (cur ? `${cur}\n` : '') + imei;
        entryPhotos.set(imei, photo);
        added++;
        updateSummary();
        return '';
      },
    });
    renderEntryPhotos();
    if (added) toast(`${plural(added, 'IMEI lido', 'IMEIs lidos')} pela câmera, com foto.`);
  });

  const parseImeis = () => form.imeis.value.split(/[\s,;]+/).map((s) => s.replace(/\D/g, '')).filter(Boolean);
  const analyze = () => {
    const list = parseImeis();
    const seen = new Set();
    const res = { valid: [], invalid: [], dup: [], inStock: [] };
    for (const i of list) {
      if (seen.has(i)) { res.dup.push(i); continue; }
      seen.add(i);
      if (!/^\d{15}$/.test(i) || !luhnOk(i)) res.invalid.push(i);
      else if (S.units.some((u) => u.imei === i && u.status !== 'saida' && u.status !== 'excluido')) res.inStock.push(i);
      else res.valid.push(i);
    }
    return res;
  };

  const updateSummary = () => {
    const a = analyze();
    const qty = mode === 'imei' ? a.valid.length : Math.max(0, Math.floor(+form.qty.value || 0));
    const cost = +form.cost.value || 0, price = +form.price.value || 0;
    if (mode === 'imei') {
      $('[data-imei-status]', root).innerHTML = [
        a.valid.length ? `<span class="ok">${icon('check')} ${a.valid.length} válido(s)</span>` : '',
        a.invalid.length ? `<span class="err" title="${esc(a.invalid.join(', '))}">${a.invalid.length} inválido(s)</span>` : '',
        a.dup.length ? `<span class="err">${a.dup.length} repetido(s)</span>` : '',
        a.inStock.length ? `<span class="err" title="${esc(a.inStock.join(', '))}">${a.inStock.length} já em estoque</span>` : '',
      ].join('');
    }
    const name = form.model.value ? `${form.model.value}${form.storage.value ? ` · ${form.storage.value}` : ''}` : 'Selecione o modelo';
    const row = (k, v) => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span class="muted">${k}</span><b class="num">${v}</b></div>`;
    $('[data-summary]', root).innerHTML = `
      <div class="cell-model" style="margin-bottom:14px"><div class="phone-ico" style="width:46px;height:46px">${icon('phone')}</div><div><strong style="font-size:15px">${esc(name)}</strong><small>${esc(form.color.value || 'Cor')} · ${esc(form.condition.value)}</small></div></div>
      ${row('Quantidade', fmtInt(qty))}
      ${row('Investimento', fmtMoney(qty * cost))}
      ${row('Receita prevista', fmtMoney(qty * price))}
      ${row('Lucro previsto', `<span style="color:${price >= cost ? 'var(--green)' : 'var(--red)'}">${fmtMoney(qty * (price - cost))}</span>`)}
      <div style="display:flex;justify-content:space-between;padding:10px 0"><span class="muted">Margem</span><b>${price > 0 ? `${(((price - cost) / price) * 100).toFixed(1)}%` : '—'}</b></div>`;
    return { a, qty };
  };

  root.addEventListener('input', (e) => { updateSummary(); if (e.target === form.imeis) renderEntryPhotos(); });
  root.addEventListener('change', updateSummary);
  form.addEventListener('reset', () => setTimeout(updateSummary));
  $('[data-mode-seg]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    $$('[data-mode]', root).forEach((x) => x.classList.toggle('active', x === b));
    $('[data-imei-box]', root).classList.toggle('hidden', mode !== 'imei');
    $('[data-qty-box]', root).classList.toggle('hidden', mode !== 'qty');
    updateSummary();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { a, qty } = updateSummary();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.model || !fd.storage || !fd.color.trim()) return toast('Preencha modelo, armazenamento e cor.', 'error');
    if (mode === 'imei') {
      if (a.invalid.length || a.dup.length || a.inStock.length) return toast('Corrija os IMEIs inválidos, repetidos ou já cadastrados.', 'error');
      if (!a.valid.length) return toast('Informe ao menos um IMEI ou use o modo por quantidade.', 'error');
    } else if (!(qty >= 1)) return toast('Informe a quantidade.', 'error');
    if (+fd.price && +fd.cost && +fd.price < +fd.cost) {
      const ok = await confirmDialog({ title: 'Preço abaixo do custo', message: 'O preço de venda está menor que o custo. Deseja continuar mesmo assim?', confirmText: 'Continuar' });
      if (!ok) return;
    }
    const photos = mode === 'imei' ? a.valid.filter((i) => entryPhotos.has(i)).map((i) => ({ imei: i, image: entryPhotos.get(i) })) : [];
    const body = { ...fd, imeis: mode === 'imei' ? a.valid : [], qty: mode === 'qty' ? qty : undefined, photos };
    try {
      const r = await withLoading($('[data-submit]', root), () => api('/api/units', { method: 'POST', body }));
      S.units.push(...r.units);
      S.movements.unshift(r.movement);
      toast(`${plural(r.units.length, 'aparelho cadastrado', 'aparelhos cadastrados')}: ${fd.model} ${fd.storage}${photos.length ? ` · ${plural(photos.length, 'foto salva', 'fotos salvas')}` : ''}`);
      if (r.photoError) toast(r.photoError, 'error');
      form.imeis.value = '';
      entryPhotos.clear();
      renderEntryPhotos();
      form.qty.value = 1;
      updateSummary();
      refreshLowBadge();
      form.imeis.focus();
    } catch (err) { toast(err.message, 'error'); }
  });
  updateSummary();
}

// ═════════════════════════ Movimentações ═════════════════════════
async function viewMovimentacoes() {
  await loadMovements();
  const f = S.mvFilter;
  const users = [...new Set(S.movements.map((m) => m.userName))].sort();
  const root = mount(`
    <div class="page-head">
      <div><h2>Movimentações</h2><p>Histórico completo de entradas, saídas e estornos.</p></div>
      <button class="btn" data-export>${icon('download')}Exportar CSV</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-icon grow">${icon('search')}<input class="input" data-f="q" placeholder="Buscar modelo, IMEI, cliente, observação…" value="${esc(f.q)}"></div>
        <select class="select" data-f="type">
          <option value="">Todos os tipos</option>
          ${Object.entries(MV_TYPE).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <select class="select" data-f="user"><option value="">Todos os usuários</option>${users.map((u) => `<option ${f.user === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
      </div>
      <div class="toolbar">
        <div class="seg" data-period>
          ${[['today', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['month', 'Este mês'], ['all', 'Tudo']].map(([k, l]) => `<button class="${f.period === k ? 'active' : ''}" data-p="${k}">${l}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" type="date" data-f="from" value="${f.from}" style="width:auto" aria-label="De">
          <span class="muted">até</span>
          <input class="input" type="date" data-f="to" value="${f.to}" style="width:auto" aria-label="Até">
        </div>
      </div>
      <div data-region></div>
    </div>
  `);

  let t;
  root.addEventListener('input', (e) => {
    if (e.target.dataset.f !== 'q') return;
    clearTimeout(t);
    t = setTimeout(() => { f.q = e.target.value.trim(); S.mvPage = 1; renderMoves(root); }, 160);
  });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (!k || k === 'q') return;
    f[k] = e.target.value;
    if (k === 'from' || k === 'to') { f.period = 'custom'; $$('[data-p]', root).forEach((x) => x.classList.remove('active')); }
    S.mvPage = 1;
    renderMoves(root);
  });
  root.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]');
    if (p) {
      f.period = p.dataset.p;
      const d = new Date();
      const back = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return localDay(x); };
      f.to = f.period === 'all' ? '' : localDay(d);
      f.from = { today: localDay(d), 7: back(6), 30: back(29), month: localDay(new Date(d.getFullYear(), d.getMonth(), 1)), all: '' }[f.period];
      $$('[data-p]', root).forEach((x) => x.classList.toggle('active', x === p));
      $('[data-f="from"]', root).value = f.from;
      $('[data-f="to"]', root).value = f.to;
      S.mvPage = 1;
      return renderMoves(root);
    }
    const b = e.target.closest('button, tr[data-id]');
    if (!b) return;
    if (b.dataset.page) { S.mvPage += Number(b.dataset.page); renderMoves(root); return; }
    if (b.matches('[data-export]')) return exportMoves();
    const id = b.closest('tr')?.dataset.id;
    const mv = S.movements.find((m) => m.id === id);
    if (!mv) return;
    if (b.dataset.revert) return revertMove(mv, root);
    openMoveDetails(mv, root);
  });
  renderMoves(root);
}

function filteredMoves() {
  const f = S.mvFilter;
  const q = f.q.toLowerCase();
  return S.movements.filter((m) => {
    if (f.type && m.type !== f.type) return false;
    if (f.user && m.userName !== f.user) return false;
    const d = localDay(m.at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (q) {
      const hay = `${m.reason} ${m.customer} ${m.note} ${m.userName} ${m.items.map((i) => `${i.model} ${i.storage} ${i.color} ${i.imei}`).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderMoves(root) {
  const list = filteredMoves();
  const valid = list.filter((m) => !m.reverted);
  const outs = valid.filter((m) => m.type === 'saida');
  const ins = valid.filter((m) => m.type === 'entrada');
  const revenue = sumBy(outs, (m) => m.value);
  const region = $('[data-region]', root);
  const stats = `<div class="stat-row">
    <span>Entradas<b>${fmtInt(sumBy(ins, (m) => m.qty))} un.</b></span>
    <span>Saídas<b>${fmtInt(sumBy(outs, (m) => m.qty))} un.</b></span>
    <span>Faturamento<b>${fmtMoney(revenue)}</b></span>
    <span>Lucro bruto<b style="color:var(--green)">${fmtMoney(revenue - sumBy(outs, (m) => m.cost))}</b></span>
    <span>Investido em compras<b>${fmtMoney(sumBy(ins, (m) => m.cost))}</b></span>
  </div>`;
  if (!list.length) { region.innerHTML = stats + emptyBlock('swap', 'Nenhuma movimentação', 'Nenhum registro para os filtros selecionados.'); return; }

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  S.mvPage = Math.min(Math.max(1, S.mvPage), pages);
  const items = list.slice((S.mvPage - 1) * PAGE, S.mvPage * PAGE);
  region.innerHTML = stats + `<div class="table-wrap"><table class="table">
    <thead><tr><th>Data</th><th>Tipo</th><th>Aparelhos</th><th>Motivo</th><th>Cliente / fornecedor</th><th>Usuário</th><th class="right">Valor</th><th></th></tr></thead>
    <tbody>${items.map((m) => {
      const t = MV_TYPE[m.type] || MV_TYPE.saida;
      const canRevert = !m.reverted && (m.type === 'saida' || m.type === 'entrada');
      return `<tr data-id="${esc(m.id)}" style="cursor:pointer" class="${m.reverted ? 'dim' : ''}">
        <td class="num" style="white-space:nowrap">${fmtDateTime(m.at)}</td>
        <td><span class="badge ${t.cls}">${t.label}</span>${m.photos ? ` <span class="photo-chip" title="${plural(m.photos, 'foto do IMEI', 'fotos do IMEI')}">${icon('camera')}${m.photos}</span>` : ''}</td>
        <td class="wrap"><strong>${esc(describe(m.items))}</strong>${m.items.some((i) => i.imei) ? `<div class="muted mono" style="font-size:11.5px">${esc(m.items.filter((i) => i.imei).slice(0, 2).map((i) => i.imei).join(', '))}${m.items.length > 2 ? '…' : ''}</div>` : ''}</td>
        <td>${esc(m.reason)}</td>
        <td>${esc(m.customer || '—')}</td>
        <td>${esc(m.userName)}</td>
        <td class="right num">${m.type === 'estorno' ? '<span class="muted">—</span>' : `<strong>${fmtMoney(m.value)}</strong>`}</td>
        <td><div class="actions">${m.reverted ? `<span class="badge violet" title="Estornada por ${esc(m.revertedBy)} em ${fmtDateTime(m.revertedAt)}">Estornada</span>` : canRevert ? `<button class="btn btn-sm btn-ghost" data-revert="1" title="Estornar">${icon('undo')}Estornar</button>` : ''}</div></td>
      </tr>`;
    }).join('')}</tbody></table></div>
    ${pages > 1 ? `<div class="pager"><span>Mostrando ${(S.mvPage - 1) * PAGE + 1}–${Math.min(S.mvPage * PAGE, list.length)} de ${list.length}</span>
      <div style="display:flex;gap:6px"><button class="btn btn-sm" data-page="-1" ${S.mvPage === 1 ? 'disabled' : ''}>${icon('chevronLeft')}</button><span style="align-self:center">${S.mvPage} / ${pages}</span><button class="btn btn-sm" data-page="1" ${S.mvPage === pages ? 'disabled' : ''}>${icon('chevronRight')}</button></div></div>` : ''}`;
}

function openMoveDetails(m, root) {
  const t = MV_TYPE[m.type] || MV_TYPE.saida;
  const canRevert = !m.reverted && (m.type === 'saida' || m.type === 'entrada');
  const md = openModal({
    size: 'lg', title: `${t.label} · ${fmtDateTime(m.at)}`,
    subtitle: `${esc(m.reason)} · registrada por ${esc(m.userName)}${m.customer ? ` · ${esc(m.customer)}` : ''}`,
    body: `
      ${m.reverted ? `<div class="banner" style="background:var(--violet-soft);border-color:transparent">${icon('undo')}<div class="grow">Estornada por <b>${esc(m.revertedBy)}</b> em ${fmtDateTime(m.revertedAt)}.</div></div>` : ''}
      ${m.note ? `<p class="text-2" style="margin-bottom:14px">${icon('file')} ${esc(m.note)}</p>` : ''}
      <div class="table-wrap" style="border:1px solid var(--border);border-radius:14px"><table class="table">
        <thead><tr><th>Aparelho</th><th>Condição</th><th>IMEI</th><th class="right">Custo</th><th class="right">Venda</th></tr></thead>
        <tbody>${m.items.map((i) => `<tr><td><strong>${esc(i.model)} · ${esc(i.storage)}</strong><div class="muted" style="font-size:12px">${esc(i.color)}</div></td><td>${conditionBadge(i.condition)}</td><td class="mono">${i.imei ? esc(fmtImei(i.imei)) : '—'}</td><td class="right num">${fmtMoney(i.cost)}</td><td class="right num">${fmtMoney(i.price)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="stat-row" style="border:0;padding:14px 0 0;justify-content:flex-end">
        <span>Quantidade<b>${m.qty}</b></span>
        ${m.type === 'saida' ? `<span>Valor<b>${fmtMoney(m.value)}</b></span><span>Lucro<b style="color:var(--green)">${fmtMoney(m.value - m.cost)}</b></span>` : m.type === 'entrada' ? `<span>Custo total<b>${fmtMoney(m.cost)}</b></span>` : ''}
      </div>
      ${m.photos ? `<div class="label" style="margin:20px 0 10px">${icon('camera')} Fotos do IMEI (comprovante)</div><div class="photo-grid" data-photos><div class="skeleton" style="height:120px"></div></div>` : ''}`,
    foot: `${canRevert ? `<button class="btn btn-danger" data-revert>${icon('undo')}Estornar</button>` : ''}<button class="btn" data-close>Fechar</button>`,
  });
  md.$('[data-revert]')?.addEventListener('click', () => { md.close(); revertMove(m, root); });
  const grid = md.$('[data-photos]');
  if (grid) {
    api(`/api/movements/${m.id}/photos`).then((list) => {
      grid.innerHTML = list.length
        ? list.map((p) => `<figure><img src="${p.image}" alt="IMEI ${esc(p.imei)}"><figcaption class="mono">${esc(fmtImei(p.imei) || 'IMEI não informado')}</figcaption></figure>`).join('')
        : '<p class="muted">Nenhuma foto encontrada.</p>';
    }).catch((err) => { grid.innerHTML = `<p class="muted">${esc(err.message)}</p>`; });
    grid.addEventListener('click', (e) => { const f = e.target.closest('figure'); if (f) openPhotoViewer(f.querySelector('img').src, f.querySelector('figcaption').textContent); });
  }
}

async function revertMove(m, root) {
  const isOut = m.type === 'saida';
  const ok = await confirmDialog({
    title: `Estornar ${isOut ? 'saída' : 'entrada'}?`,
    message: isOut
      ? `Os aparelhos (<b>${esc(describe(m.items))}</b>) voltarão para o estoque como disponíveis.`
      : `Os aparelhos desta entrada (<b>${esc(describe(m.items))}</b>) serão removidos do estoque.`,
    confirmText: 'Estornar', danger: !isOut, iconName: 'undo',
  });
  if (!ok) return;
  try {
    await api(`/api/movements/${m.id}/revert`, { method: 'POST', body: {} });
    await Promise.all([loadMovements(), loadUnits()]);
    toast('Movimentação estornada.');
    renderMoves(root);
    refreshLowBadge();
  } catch (err) { toast(err.message, 'error'); }
}

function exportMoves() {
  const list = filteredMoves();
  const rows = [];
  for (const m of list) for (const i of m.items) {
    rows.push([fmtDateTime(m.at), MV_TYPE[m.type]?.label, m.reverted ? 'Sim' : 'Não', i.model, i.storage, i.color, i.condition, i.imei, String(i.cost).replace('.', ','), String(i.price).replace('.', ','), m.reason, m.customer, m.userName, m.note]);
  }
  downloadCSV(`movimentacoes-${localDay(new Date())}.csv`, ['Data', 'Tipo', 'Estornada', 'Modelo', 'Armazenamento', 'Cor', 'Condição', 'IMEI', 'Custo', 'Preço', 'Motivo', 'Cliente/Fornecedor', 'Usuário', 'Observação'], rows);
  toast(`${plural(rows.length, 'linha exportada', 'linhas exportadas')}.`, 'info');
}

// ═════════════════════════ Usuários ═════════════════════════
async function viewUsuarios() {
  S.users = await api('/api/users');
  refreshPendingBadge(S.users);
  const pending = S.users.filter((u) => u.pending);
  const removedUsers = S.users.filter((u) => u.removed);
  const members = S.users.filter((u) => !u.pending && !u.removed);
  const root = mount(`
    <div class="page-head">
      <div><h2>Usuários</h2><p>Cada pessoa tem o seu próprio cadastro, todos ligados ao mesmo estoque.</p></div>
      <button class="btn btn-primary" data-new>${icon('plus')}Novo usuário</button>
    </div>

    ${pending.length ? `
    <div class="card" style="margin-bottom:20px;border-color:rgba(255,159,46,.35)">
      <div class="card-head">
        <div><h3>Solicitações de acesso</h3><p>Pessoas que criaram conta e aguardam sua validação</p></div>
        <span class="badge orange">${pending.length} pendente${pending.length > 1 ? 's' : ''}</span>
      </div>
      <div class="list">${pending.map((u) => `
        <div class="list-item" data-id="${esc(u.id)}" style="flex-wrap:wrap">
          <div class="avatar violet">${esc(initials(u.name))}</div>
          <div class="grow"><strong>${esc(u.name)}</strong><small>${esc(u.email)} · solicitado ${fmtRelative(u.createdAt)}</small></div>
          <select class="select" data-approve-role style="width:auto;height:34px;font-size:12.5px" aria-label="Perfil">
            <option value="colaborador">Como colaborador</option>
            <option value="admin">Como administrador</option>
          </select>
          <button class="btn btn-sm btn-primary" data-act="approve">${icon('check')}Aprovar</button>
          <button class="btn btn-sm btn-danger" data-act="reject">${icon('x')}Recusar</button>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="card join-card" style="margin-bottom:20px">
      <div class="card-body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div class="k-ico" style="width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--gold-grad);color:var(--on-gold)">${icon('crown')}</div>
        <div style="flex:1;min-width:240px">
          <strong style="font-size:15px">Código da loja</strong>
          <p class="muted" style="font-size:12.5px;margin-top:2px">O colaborador cria a própria conta em <b>Criar conta</b> na tela de login e informa este código: o acesso é liberado na hora, ligado a este mesmo estoque.</p>
        </div>
        <div class="join-code mono" data-join>${esc(S.settings.joinCode || '—')}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" data-join-copy>${icon('copy')}Copiar</button>
          <button class="btn btn-sm btn-ghost" data-join-new title="Gera outro código; o anterior deixa de funcionar">${icon('refresh')}Novo código</button>
        </div>
      </div>
    </div>

    <div class="kpis">
      <div class="card kpi"><div class="k-top"><span class="k-label">Administradores</span><span class="k-ico">${icon('crown')}</span></div><div class="k-value">${members.filter((u) => u.role === 'admin').length}</div><div class="k-foot">Acesso total ao sistema</div></div>
      <div class="card kpi"><div class="k-top"><span class="k-label">Colaboradores</span><span class="k-ico">${icon('users')}</span></div><div class="k-value">${members.filter((u) => u.role === 'colaborador').length}</div><div class="k-foot">Consultam estoque e registram saídas</div></div>
      <div class="card kpi"><div class="k-top"><span class="k-label">Aguardando validação</span><span class="k-ico">${icon('clock')}</span></div><div class="k-value">${pending.length}</div><div class="k-foot">Contas criadas pela tela de login</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${members.map((u) => `<tr data-id="${esc(u.id)}" class="${u.active ? '' : 'dim'}">
        <td><div class="cell-model"><div class="avatar ${u.role === 'admin' ? '' : 'violet'}">${esc(initials(u.name))}</div><div><strong>${esc(u.name)}${u.id === S.me.id ? ' <span class="badge plain gold" style="height:20px">Você</span>' : ''}</strong><small>${esc(u.email)}</small></div></div></td>
        <td>${u.role === 'admin' ? `<span class="badge gold">Administrador</span>` : `<span class="badge violet">Colaborador</span>`}</td>
        <td>${u.active ? '<span class="badge green">Ativo</span>' : '<span class="badge red">Inativo</span>'}${u.defaultPassword ? ' <span class="badge orange" title="Ainda usa a senha padrão">Senha padrão</span>' : ''}${!u.lastLogin ? ' <span class="badge blue" title="Ainda não entrou no sistema">Nunca entrou</span>' : ''}</td>
        <td title="Criado em ${fmtDate(u.createdAt)}">${u.lastLogin ? fmtRelative(u.lastLogin) : '<span class="muted">Nunca</span>'}</td>
        <td><div class="actions">
          ${u.id !== S.me.id ? `<button class="btn btn-sm btn-ghost" data-act="link" title="Link de acesso e e-mail de senha">${icon('link')}Acesso</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="toggle" ${u.id === S.me.id ? 'disabled' : ''}>${u.active ? 'Desativar' : 'Ativar'}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" title="Editar">${icon('edit')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="del" title="Excluir" ${u.id === S.me.id ? 'disabled' : ''}>${icon('trash')}</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div></div>
    ${removedUsers.length ? `<details class="card" style="margin-top:20px"><summary class="card-body" style="cursor:pointer"><b>Usuários removidos (${removedUsers.length})</b> <span class="muted">— o histórico deles é mantido; você pode reativar o acesso</span></summary>
      <div class="list">${removedUsers.map((u) => `<div class="list-item" data-id="${esc(u.id)}">
        <div class="avatar violet">${esc(initials(u.name))}</div>
        <div class="grow"><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${u.status === 'rejected' ? 'solicitação recusada' : 'acesso removido'}${u.removedAt ? ` em ${fmtDate(u.removedAt)}` : ''}</small></div>
        <button class="btn btn-sm" data-act="reactivate">${icon('undo')}Reativar</button></div>`).join('')}</div></details>` : ''}
  `);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-new]')) return openUserForm();
    if (b.dataset.act === 'reactivate') {
      const u = S.users.find((x) => x.id === b.closest('[data-id]').dataset.id);
      try { await api(`/api/users/${u.id}`, { method: 'PUT', body: { active: true } }); toast(`Acesso de ${u.name} reativado.`); rerender(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (b.matches('[data-join-copy]')) {
      try { await navigator.clipboard.writeText(S.settings.joinCode); } catch {}
      return toast(`Código ${S.settings.joinCode} copiado.`);
    }
    if (b.matches('[data-join-new]')) {
      const ok = await confirmDialog({ title: 'Gerar novo código?', message: 'O código atual deixará de funcionar para novos cadastros. Quem já tem conta não é afetado.', confirmText: 'Gerar novo código', iconName: 'refresh' });
      if (!ok) return;
      try { S.settings.joinCode = (await api('/api/settings/join-code', { method: 'POST' })).joinCode; $('[data-join]', root).textContent = S.settings.joinCode; toast('Novo código gerado.'); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const row = b.closest('[data-id]');
    const u = S.users.find((x) => x.id === row?.dataset.id);
    if (!u) return;
    if (b.dataset.act === 'approve') {
      const asRole = $('[data-approve-role]', row).value;
      try {
        await api(`/api/users/${u.id}/approve`, { method: 'POST', body: { role: asRole } });
        toast(`Acesso de ${u.name} aprovado como ${asRole === 'admin' ? 'administrador' : 'colaborador'}.`);
        rerender();
      } catch (err) { toast(err.message, 'error'); }
    }
    if (b.dataset.act === 'reject') {
      const ok = await confirmDialog({ title: 'Recusar solicitação?', message: `<b>${esc(u.name)}</b> (${esc(u.email)}) não terá acesso ao sistema. A pessoa poderá se cadastrar novamente depois.`, confirmText: 'Recusar', danger: true });
      if (!ok) return;
      try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); toast('Solicitação recusada.'); rerender(); } catch (err) { toast(err.message, 'error'); }
    }
    if (b.dataset.act === 'edit') openUserForm(u);
    if (b.dataset.act === 'link') openLinkModal(u);
    if (b.dataset.act === 'toggle') {
      try { await api(`/api/users/${u.id}`, { method: 'PUT', body: { active: !u.active } }); toast(u.active ? 'Usuário desativado.' : 'Usuário ativado.'); rerender(); } catch (err) { toast(err.message, 'error'); }
    }
    if (b.dataset.act === 'del') {
      const ok = await confirmDialog({ title: 'Remover acesso?', message: `<b>${esc(u.name)}</b> (${esc(u.email)}) não conseguirá mais entrar. O cadastro e todo o histórico feito por essa pessoa são mantidos, e você pode reativar depois em “Usuários removidos”.`, confirmText: 'Remover acesso', danger: true });
      if (!ok) return;
      try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); toast('Acesso removido. O histórico foi mantido.'); rerender(); } catch (err) { toast(err.message, 'error'); }
    }
  });
}

function openUserForm(u) {
  const editing = !!u;
  let role = u?.role || 'colaborador';
  const m = openModal({
    title: editing ? 'Editar usuário' : 'Novo usuário',
    subtitle: editing ? esc(u.email) : 'Cadastre o e-mail e a senha. A pessoa poderá entrar imediatamente.',
    body: `<form class="form-grid" data-form>
      <div class="field span-all"><label>Perfil de acesso</label>
        <div class="seg" data-role-seg style="width:100%">
          <button type="button" data-role="colaborador" style="flex:1;justify-content:center" class="${role === 'colaborador' ? 'active' : ''}">${icon('user')}Colaborador</button>
          <button type="button" data-role="admin" style="flex:1;justify-content:center" class="${role === 'admin' ? 'active' : ''}">${icon('crown')}Administrador</button>
        </div>
        <span class="hint" data-role-hint></span>
      </div>
      <div class="field"><label>Nome completo</label><input class="input" name="name" maxlength="60" required value="${esc(u?.name || '')}" placeholder="Ex.: Maria Silva"></div>
      <div class="field"><label>E-mail (login)</label><input class="input" type="email" name="email" maxlength="120" required value="${esc(u?.email || '')}" placeholder="maria@exemplo.com" autocapitalize="none" spellcheck="false" ${editing ? 'disabled' : ''}></div>
      ${editing ? `<div class="field span-all"><label>Senha</label><div>${u.id === S.me.id
        ? `<button type="button" class="btn btn-sm" data-own-pw>${icon('lock')}Alterar minha senha</button>`
        : `<button type="button" class="btn btn-sm" data-reset-pw data-loading="Enviando...">${icon('chat')}Enviar e-mail para redefinir a senha</button>`}</div>
        <span class="hint">Por segurança, cada pessoa define a própria senha.</span></div>` : `
      <div class="field"><label>Senha <span class="muted">(opcional)</span></label><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" placeholder="Em branco = convite por e-mail"></div>
      <div class="field"><label>Confirmar senha</label><input class="input" name="confirm" type="password" minlength="6" autocomplete="new-password" placeholder="Repita a senha"></div>
      <p class="hint span-all" style="display:flex;gap:8px;align-items:flex-start">${icon('chat')}<span>Deixando a senha em branco, a pessoa recebe um <b>e-mail para criar a própria senha</b> e depois entra pelo link do sistema.</span></p>`}
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>${icon('check')}${editing ? 'Salvar' : 'Cadastrar usuário'}</button>`,
  });
  const hint = () => {
    m.$('[data-role-hint]').textContent = role === 'admin'
      ? 'Acesso total: estoque, preços, entradas, estornos, usuários e configurações.'
      : 'Vê a quantidade de aparelhos por modelo e capacidade e registra saídas. Não vê preços.';
  };
  hint();
  m.$('[data-role-seg]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    role = b.dataset.role;
    m.$$('[data-role]').forEach((x) => x.classList.toggle('active', x === b));
    hint();
  });
  const save = async () => {
    const fd = Object.fromEntries(new FormData(m.$('[data-form]')));
    if (fd.password && fd.password !== fd.confirm) return toast('As senhas não conferem.', 'error');
    const body = editing ? { name: fd.name, role } : { name: fd.name, email: fd.email, role };
    if (!editing && fd.password) body.password = fd.password;
    try {
      const saved = await withLoading(m.$('[data-save]'), () => api(editing ? `/api/users/${u.id}` : '/api/users', { method: editing ? 'PUT' : 'POST', body }));
      m.close();
      toast(editing ? 'Usuário atualizado.' : 'Usuário cadastrado.');
      if (!editing) setTimeout(() => openLinkModal(saved, true), 250);
      if (editing && u.id === S.me.id) { S.me = (await api('/api/me')).user; renderShell(); }
      rerender();
    } catch (err) { toast(err.message, 'error'); }
  };
  m.$('[data-save]').addEventListener('click', save);
  m.$('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  m.$('[data-own-pw]')?.addEventListener('click', () => { m.close(); openChangePassword(); });
  m.$('[data-reset-pw]')?.addEventListener('click', async (e) => {
    try { await withLoading(e.currentTarget, () => api(`/api/users/${u.id}/reset`, { method: 'POST' })); toast(`E-mail de redefinição enviado para ${u.email}.`); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// Acesso individual: link do sistema com o e-mail da pessoa + e-mail do Firebase para criar/redefinir a senha
function openLinkModal(u, justCreated = false) {
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const link = `${base}index.html?email=${encodeURIComponent(u.email)}`;
  const first = u.name.split(' ')[0];
  const msg = `Olá, ${first}! Este é o seu acesso ao estoque da ${S.settings.storeName}:\n${link}\n${justCreated && u.invited ? 'Você vai receber um e-mail para criar a sua senha. Depois é só entrar pelo link acima.' : 'Entre com o seu e-mail e senha.'}`;
  const m = openModal({
    size: 'lg',
    title: justCreated ? 'Usuário cadastrado! Envie o acesso' : `Acesso de ${u.name}`,
    subtitle: `${esc(u.email)}${justCreated && u.invited ? ' · um e-mail para criar a senha já foi enviado' : ''}`,
    body: `
      <div class="field">
        <label>Link de acesso</label>
        <div style="display:flex;gap:8px">
          <input class="input mono" data-url readonly value="${esc(link)}">
          <button class="btn btn-primary" data-copy>${icon('copy')}Copiar</button>
        </div>
        <span class="hint">Abre a tela de login com o e-mail da pessoa já preenchido.</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${icon('chat')}Enviar pelo WhatsApp</a>
        <button class="btn btn-ghost" data-reset data-loading="Enviando...">${icon('lock')}Enviar e-mail para ${justCreated && u.invited ? 'reenviar o convite' : 'criar/redefinir a senha'}</button>
      </div>
      <div class="banner" style="margin:18px 0 4px;background:var(--surface-2);border-color:var(--border)">
        ${icon('globe')}
        <div class="grow text-2" style="font-size:12.5px">O link funciona de qualquer lugar (celular, outro computador, outra rede). A pessoa entra com o <b>próprio e-mail e senha</b>. O e-mail de senha é enviado pelo Firebase. Peça para conferir também a caixa de spam.</div>
      </div>`,
    foot: `<button class="btn" data-close>Fechar</button>`,
  });
  m.$('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); } catch { m.$('[data-url]').select(); document.execCommand('copy'); }
    toast('Link copiado.');
  });
  m.$('[data-reset]').addEventListener('click', async (e) => {
    try { await withLoading(e.currentTarget, () => api(`/api/users/${u.id}/reset`, { method: 'POST' })); toast(`E-mail enviado para ${u.email}.`); }
    catch (err) { toast(err.message, 'error'); }
  });
}

async function refreshPendingBadge(users) {
  if (!users) { try { users = await api('/api/users'); } catch { return; } }
  const n = users.filter((u) => u.pending).length;
  const el = $('#pendingCount');
  el.textContent = n;
  el.title = `${n} solicitação(ões) de acesso aguardando validação`;
  el.classList.toggle('hidden', !n);
}

// ═════════════════════════ Auditoria ═════════════════════════
async function viewAuditoria() {
  S.logs = await api('/api/logs');
  const f = S.logFilter;
  const actions = [...new Set(S.logs.map((l) => l.action))].sort();
  const root = mount(`
    <div class="page-head">
      <div><h2>Auditoria</h2><p>Registro de todas as ações realizadas no sistema.</p></div>
      <button class="btn" data-export>${icon('download')}Exportar CSV</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-icon grow">${icon('search')}<input class="input" data-f="q" placeholder="Buscar por usuário ou descrição…" value="${esc(f.q)}"></div>
        <select class="select" data-f="action"><option value="">Todas as ações</option>${actions.map((a) => `<option ${f.action === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      </div>
      <div data-region></div>
    </div>
  `);
  const filtered = () => S.logs.filter((l) => (!f.action || l.action === f.action) && (!f.q || `${l.userName} ${l.detail}`.toLowerCase().includes(f.q.toLowerCase())));
  const ACTION_CLS = { Login: 'blue', Saída: 'orange', Entrada: 'green', Estorno: 'violet', Exclusão: 'red', Usuários: 'gold', Configurações: 'gold', Senha: 'gold' };
  const render = () => {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    S.logPage = Math.min(Math.max(1, S.logPage), pages);
    const items = list.slice((S.logPage - 1) * PAGE, S.logPage * PAGE);
    $('[data-region]', root).innerHTML = list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Descrição</th></tr></thead>
      <tbody>${items.map((l) => `<tr><td class="num" style="white-space:nowrap">${fmtDateTime(l.at)}</td><td>${esc(l.userName)}</td><td><span class="badge ${ACTION_CLS[l.action] || ''}">${esc(l.action)}</span></td><td class="text-2 wrap">${esc(l.detail)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${pages > 1 ? `<div class="pager"><span>${list.length} registros</span><div style="display:flex;gap:6px"><button class="btn btn-sm" data-page="-1" ${S.logPage === 1 ? 'disabled' : ''}>${icon('chevronLeft')}</button><span style="align-self:center">${S.logPage} / ${pages}</span><button class="btn btn-sm" data-page="1" ${S.logPage === pages ? 'disabled' : ''}>${icon('chevronRight')}</button></div></div>` : ''}`
      : emptyBlock('shield', 'Nenhum registro', 'Nada encontrado para os filtros.');
  };
  let t;
  root.addEventListener('input', (e) => { if (e.target.dataset.f === 'q') { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); S.logPage = 1; render(); }, 160); } });
  root.addEventListener('change', (e) => { if (e.target.dataset.f === 'action') { f.action = e.target.value; S.logPage = 1; render(); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.page) { S.logPage += Number(b.dataset.page); render(); }
    if (b?.matches('[data-export]')) downloadCSV(`auditoria-${localDay(new Date())}.csv`, ['Data', 'Usuário', 'Ação', 'Descrição'], filtered().map((l) => [fmtDateTime(l.at), l.userName, l.action, l.detail]));
  });
  render();
}

// ═════════════════════════ Configurações ═════════════════════════
async function viewConfig() {
  S.settings = await api('/api/settings');
  const s = S.settings;
  const chipEditor = (key, title, desc, placeholder) => `
    <div class="settings-section">
      <div><h4>${title}</h4><p>${desc}</p></div>
      <div class="chip-editor" data-list="${key}">
        <div class="chips">${s[key].map((v) => `<span class="chip" style="cursor:default">${esc(v)}<button class="x" data-remove="${esc(v)}" aria-label="Remover ${esc(v)}">${icon('x')}</button></span>`).join('')}</div>
        <form data-add="${key}"><input class="input" name="v" placeholder="${placeholder}" maxlength="60" style="height:38px"><button class="btn btn-sm" style="height:38px">${icon('plus')}Adicionar</button></form>
      </div>
    </div>`;
  const root = mount(`
    <div class="page-head"><div><h2>Configurações</h2><p>Personalize o catálogo e as regras do sistema.</p></div></div>
    <div class="card card-pad" style="padding-top:0;padding-bottom:0">
      <div class="settings-section">
        <div><h4>Loja</h4><p>Nome exibido no sistema e limite para alerta de estoque baixo.</p></div>
        <form class="form-grid" data-store-form style="max-width:560px">
          <div class="field"><label>Nome da loja</label><input class="input" name="storeName" maxlength="60" value="${esc(s.storeName)}"></div>
          <div class="field"><label>Alerta de estoque baixo</label><input class="input" type="number" name="lowStock" min="0" max="999" value="${s.lowStock}"><span class="hint">Avisar quando houver esta quantidade ou menos por modelo/capacidade.</span></div>
          <div><button class="btn btn-primary btn-sm">${icon('check')}Salvar</button></div>
        </form>
      </div>
      ${chipEditor('models', 'Modelos de iPhone', 'Lista exibida nos cadastros. A ordem define do mais antigo para o mais novo.', 'Ex.: iPhone 18 Pro')}
      ${chipEditor('storages', 'Capacidades', 'Opções de armazenamento disponíveis.', 'Ex.: 4TB')}
      ${chipEditor('colors', 'Cores', 'Sugestões de cores ao cadastrar aparelhos.', 'Ex.: Azul Meia-noite')}
      <div class="settings-section">
        <div><h4>Segurança</h4><p>Altere a senha da sua conta de administrador.</p></div>
        <div><button class="btn" data-pw>${icon('lock')}Alterar minha senha</button></div>
      </div>
      <div class="settings-section">
        <div><h4>Backup</h4><p>Os dados ficam guardados no Firebase (Google). O backup é uma <b>cópia extra</b> para guardar fora do sistema — faça toda semana e guarde no Google Drive, pen drive ou e-mail.</p></div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" data-backup data-loading="Gerando...">${icon('database')}Baixar backup</button>
            <button class="btn" data-backup-photos data-loading="Gerando...">${icon('camera')}Backup com fotos (maior)</button>
          </div>
          <span class="hint" data-last-backup></span>
        </div>
      </div>
      <div class="settings-section">
        <div><h4>Restaurar backup</h4><p>Recupera aparelhos, movimentações e auditoria a partir de um arquivo de backup. <b>Só adiciona o que estiver faltando</b> — nada que já existe é alterado ou apagado. Também importa o arquivo <span class="mono">data/db.json</span> do sistema antigo.</p></div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">
          <label class="btn">${icon('undo')}Escolher arquivo de backup<input type="file" accept=".json,application/json" data-restore-file hidden></label>
          <span class="hint">Você verá um resumo antes de confirmar.</span>
        </div>
      </div>
    </div>
  `);

  const saveSettings = async (patch, msg) => {
    try {
      S.settings = await api('/api/settings', { method: 'PUT', body: patch });
      renderShell();
      toast(msg);
      return true;
    } catch (err) { toast(err.message, 'error'); return false; }
  };
  const showLast = (d) => { $('[data-last-backup]', root).textContent = d ? `Último backup: ${fmtDateTime(d)}` : 'Nenhum backup feito ainda.'; };
  api('/api/dashboard').then((d) => showLast(d.lastBackupAt)).catch(() => {});
  $('[data-backup]', root).addEventListener('click', async (e) => { try { await downloadBackup(e.currentTarget); showLast(new Date().toISOString()); } catch (err) { toast(err.message, 'error'); } });
  $('[data-backup-photos]', root).addEventListener('click', async (e) => { try { await downloadBackup(e.currentTarget, true); showLast(new Date().toISOString()); } catch (err) { toast(err.message, 'error'); } });
  $('[data-restore-file]', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('Este arquivo não é um backup válido (JSON).', 'error'); }
    let pv;
    try { pv = await api('/api/restore/preview', { method: 'POST', body: { data } }); } catch (err) { return toast(err.message, 'error'); }
    const m = pv.missing, tot = pv.total;
    const nothing = !m.units && !m.movements && !m.logs && !m.photos;
    const ok = await confirmDialog({
      title: nothing ? 'Nada para restaurar' : 'Restaurar backup?',
      iconName: 'undo',
      message: `Arquivo: <b>${esc(pv.source)}</b><br><br>
        <table style="width:100%;font-size:13px"><tr><th style="text-align:left"></th><th>No arquivo</th><th>Faltando no sistema</th></tr>
        <tr><td>Aparelhos</td><td class="center">${tot.units}</td><td class="center"><b>${m.units}</b></td></tr>
        <tr><td>Movimentações</td><td class="center">${tot.movements}</td><td class="center"><b>${m.movements}</b></td></tr>
        <tr><td>Auditoria</td><td class="center">${tot.logs}</td><td class="center"><b>${m.logs}</b></td></tr>
        <tr><td>Fotos</td><td class="center">${tot.photos}</td><td class="center"><b>${m.photos}</b></td></tr></table><br>
        ${nothing ? 'Tudo o que está no arquivo já existe no sistema.' : 'Só os itens <b>faltando</b> serão adicionados. Nada existente será alterado.'}`,
      confirmText: nothing ? 'Ok' : 'Restaurar',
    });
    if (!ok || nothing) return;
    try {
      const r = await api('/api/restore', { method: 'POST', body: { data } });
      toast(`Restaurado: ${r.restored.units} aparelho(s), ${r.restored.movements} movimentação(ões), ${r.restored.logs} registro(s), ${r.restored.photos} foto(s).`);
      S.units = []; S.movements = [];
    } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-store-form]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await saveSettings({ storeName: fd.storeName, lowStock: Number(fd.lowStock) }, 'Configurações da loja salvas.');
    refreshLowBadge();
  });
  root.addEventListener('submit', async (e) => {
    const key = e.target.dataset.add;
    if (!key) return;
    e.preventDefault();
    const v = e.target.v.value.trim();
    if (!v) return;
    if (S.settings[key].some((x) => x.toLowerCase() === v.toLowerCase())) return toast('Este item já existe.', 'error');
    if (await saveSettings({ [key]: [...S.settings[key], v] }, `“${v}” adicionado.`)) viewConfig();
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pw]')) return openChangePassword();
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    const key = rm.closest('[data-list]').dataset.list;
    const v = rm.dataset.remove;
    if (await saveSettings({ [key]: S.settings[key].filter((x) => x !== v) }, `“${v}” removido.`)) viewConfig();
  });
}

boot();
