/* Império Cell — utilidades compartilhadas (admin, colaborador e login) */
'use strict';

// ── Tema (aplicado antes da renderização para evitar "piscar")
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch {}
  if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
})();
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  document.querySelectorAll('[data-theme-icon]').forEach((el) => { el.innerHTML = icon(next === 'light' ? 'moon' : 'sun'); });
}
const themeIcon = () => icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');

// ── DOM helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// ── Formatação
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMoney = (n) => BRL.format(n || 0);
const fmtInt = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return fmtDate(iso);
}
const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const fmtImei = (s) => (s ? s.replace(/^(\d{2})(\d{6})(\d{6})(\d)$/, '$1 $2 $3 $4') : '');

// ── Ícones (traços no estilo Lucide)
const ICONS = {
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  grid: '<rect width="7" height="9" x="3" y="3" rx="1.5"/><rect width="7" height="5" x="14" y="3" rx="1.5"/><rect width="7" height="9" x="14" y="12" rx="1.5"/><rect width="7" height="5" x="3" y="16" rx="1.5"/>',
  box: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  out: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  in: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="3"/><path d="M10 5h4"/><path d="M12 18h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  battery: '<rect width="16" height="10" x="2" y="7" rx="2"/><path d="M22 11v2"/><path d="M6 11v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8M8 17h5"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  barcode: '<path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14"/>',
  sparkle: '<path d="M9.94 14.06 4 20M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
// data-ico="x" → substitui o conteúdo; data-ico-left / data-icon-in → insere o ícone no início
function hydrateIcons(root = document) {
  $$('[data-ico]', root).forEach((el) => { el.innerHTML = icon(el.dataset.ico); });
  $$('[data-ico-left], [data-icon-in]', root).forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icoLeft || el.dataset.iconIn)));
  $$('[data-theme-icon]', root).forEach((el) => { el.innerHTML = themeIcon(); });
}
// "Império Cell" → Império <b>CELL</b>
function brandHtml(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return esc(name);
  const last = parts.pop();
  return `${esc(parts.join(' '))} <b>${esc(last.toUpperCase())}</b>`;
}

// ── API
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'X-Area': document.documentElement.dataset.area || 'colaborador' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !['/api/login', '/api/register'].includes(path) && !path.startsWith('/api/invite/')) {
    location.href = document.documentElement.dataset.area === 'admin' ? '/login?area=admin' : '/login';
    throw new Error('Sessão expirada.');
  }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.href = '/login';
}

// ── Toasts
function toast(message, type = 'success') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="t-ico">${icon(type === 'error' ? 'x' : type === 'info' ? 'sparkle' : 'check')}</div><div>${esc(message)}</div>`;
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, type === 'error' ? 5200 : 3400);
}

// ── Modal
function openModal({ title, subtitle = '', body = '', foot = '', size = '', onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.add('closing');
    setTimeout(() => { back.remove(); prevFocus?.focus?.(); }, 160);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && back === $$('.modal-backdrop').at(-1)) close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => $('[autofocus], .modal-body input:not([type=hidden]), .modal-body select', back)?.focus(), 60);
  return { el: back, close, $: (s) => $(s, back), $$: (s) => $$(s, back) };
}

function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false, iconName }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      size: 'sm', title: '',
      body: `<div class="confirm-ico ${danger ? 'danger' : ''}">${icon(iconName || (danger ? 'alert' : 'sparkle'))}</div>
             <h3 style="font-size:18px;font-weight:700;letter-spacing:-.02em">${esc(title)}</h3>
             <p class="text-2" style="margin-top:6px">${message}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    m.$('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); m.close(); });
    setTimeout(() => m.$('[data-ok]').focus(), 70);
  });
}

// Botão com estado de carregamento
async function withLoading(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${btn.dataset.loading || 'Salvando...'}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

// ── CSV
function downloadCSV(filename, header, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Ordenação por catálogo
function modelRank(models) {
  const idx = new Map(models.map((m, i) => [m, i]));
  return (m) => (idx.has(m) ? idx.get(m) : 9999);
}
function storageRank(storages) {
  const toGb = (s) => { const n = parseFloat(s); return /tb/i.test(s) ? n * 1024 : n; };
  return (s) => { const i = storages.indexOf(s); return i >= 0 ? i : 100 + (toGb(s) || 0); };
}

const STATUS = {
  disponivel: { label: 'Disponível', cls: 'green' },
  reservado: { label: 'Reservado', cls: 'blue' },
  manutencao: { label: 'Manutenção', cls: 'orange' },
  saida: { label: 'Saiu', cls: '' },
};
const MV_TYPE = {
  entrada: { label: 'Entrada', cls: 'green', icon: 'in' },
  saida: { label: 'Saída', cls: 'orange', icon: 'out' },
  estorno: { label: 'Estorno', cls: 'violet', icon: 'undo' },
};
const conditionBadge = (c) => `<span class="badge plain ${c === 'Novo' ? 'gold' : c === 'Seminovo' ? 'violet' : 'blue'}">${esc(c)}</span>`;

/* ═════════ Assistente de saída (usado pelo colaborador e pelo admin) ═════════
 * groups: [{model, storage, color, condition, qty}] — somente aparelhos disponíveis
 */
function openSaidaWizard({ groups, settings, preset = {}, onDone }) {
  const mRank = modelRank(settings.models);
  const sRank = storageRank(settings.storages);
  const st = { model: preset.model || '', storage: preset.storage || '', variant: '', qty: 1, useImei: false };

  const models = [...new Set(groups.map((g) => g.model))].sort((a, b) => mRank(a) - mRank(b) || a.localeCompare(b));
  const sumQty = (arr) => arr.reduce((s, g) => s + g.qty, 0);

  const m = openModal({
    size: 'lg',
    title: 'Registrar saída',
    subtitle: 'Selecione o aparelho que está saindo do estoque.',
    body: `<div data-wiz></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-submit data-loading="Registrando...">${icon('out')}Confirmar saída</button>`,
  });
  const root = m.$('[data-wiz]');

  const variantsFor = () => groups
    .filter((g) => g.model === st.model && g.storage === st.storage)
    .sort((a, b) => a.color.localeCompare(b.color) || a.condition.localeCompare(b.condition));
  const maxQty = () => {
    const vs = variantsFor();
    if (st.variant) return vs.find((v) => `${v.color}|${v.condition}` === st.variant)?.qty || 0;
    return sumQty(vs);
  };

  function render() {
    if (!models.length) {
      root.innerHTML = `<div class="empty"><div class="empty-ico">${icon('box')}</div><h4>Sem aparelhos disponíveis</h4><p>Não há iPhones disponíveis para saída no momento.</p></div>`;
      m.$('[data-submit]').disabled = true;
      return;
    }
    const storages = [...new Set(groups.filter((g) => g.model === st.model).map((g) => g.storage))].sort((a, b) => sRank(a) - sRank(b));
    if (st.storage && !storages.includes(st.storage)) st.storage = '';
    if (!st.storage && storages.length === 1) st.storage = storages[0];
    const variants = st.storage ? variantsFor() : [];
    if (variants.length === 1) st.variant = `${variants[0].color}|${variants[0].condition}`;
    const max = maxQty();
    if (st.qty > max) st.qty = Math.max(1, max);

    root.innerHTML = `
      <div class="seg" style="margin-bottom:18px">
        <button type="button" data-mode="sel" class="${!st.useImei ? 'active' : ''}">${icon('phone')}Por modelo</button>
        <button type="button" data-mode="imei" class="${st.useImei ? 'active' : ''}">${icon('barcode')}Por IMEI</button>
      </div>
      ${st.useImei ? `
        <div class="field">
          <label for="w-imei">IMEI do aparelho</label>
          <input class="input mono" id="w-imei" inputmode="numeric" maxlength="20" placeholder="Digite ou escaneie os 15 dígitos" value="${esc(st.imei || '')}" autofocus>
          <span class="hint">Use o leitor de código de barras ou digite o IMEI que aparece na caixa (*#06#).</span>
        </div>` : `
        <div class="step-label"><span class="n">1</span>Modelo</div>
        <select class="select" data-model>
          <option value="">Selecione o modelo…</option>
          ${models.map((md) => `<option value="${esc(md)}" ${md === st.model ? 'selected' : ''}>${esc(md)} — ${sumQty(groups.filter((g) => g.model === md))} un.</option>`).join('')}
        </select>
        ${st.model ? `
          <div class="step-label"><span class="n">2</span>Armazenamento</div>
          <div class="opt-grid">
            ${storages.map((s) => { const q = sumQty(groups.filter((g) => g.model === st.model && g.storage === s)); return `<button type="button" class="opt ${s === st.storage ? 'active' : ''}" data-storage="${esc(s)}"><strong>${esc(s)}</strong><small>${plural(q, 'disponível', 'disponíveis')}</small></button>`; }).join('')}
          </div>` : ''}
        ${st.storage ? `
          <div class="step-label"><span class="n">3</span>Cor e condição</div>
          <div class="opt-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
            ${variants.length > 1 ? `<button type="button" class="opt ${!st.variant ? 'active' : ''}" data-variant=""><strong>Qualquer</strong><small>${sumQty(variants)} un. · mais antigo primeiro</small></button>` : ''}
            ${variants.map((v) => { const k = `${v.color}|${v.condition}`; return `<button type="button" class="opt ${k === st.variant ? 'active' : ''}" data-variant="${esc(k)}"><strong>${esc(v.color)}</strong><small>${esc(v.condition)} · ${v.qty} un.</small></button>`; }).join('')}
          </div>
          <div class="step-label"><span class="n">4</span>Quantidade</div>
          <div class="qty-ctl">
            <button type="button" data-qty="-1" aria-label="Diminuir">${icon('minus')}</button>
            <input type="number" min="1" max="${max}" value="${st.qty}" data-qty-input aria-label="Quantidade">
            <button type="button" data-qty="1" aria-label="Aumentar">${icon('plus')}</button>
          </div>
          <span class="muted" style="margin-left:10px;font-size:12.5px">máx. ${max}</span>` : ''}
      `}
      <div class="form-grid" style="margin-top:20px">
        <div class="field">
          <label for="w-reason">Motivo</label>
          <select class="select" id="w-reason">${settings.reasons.map((r) => `<option ${r === (st.reason || 'Venda') ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="w-customer">Cliente <span class="muted">(opcional)</span></label>
          <input class="input" id="w-customer" maxlength="80" placeholder="Nome do cliente" value="${esc(st.customer || '')}">
        </div>
        <div class="field span-all">
          <label for="w-note">Observação <span class="muted">(opcional)</span></label>
          <input class="input" id="w-note" maxlength="300" placeholder="Ex.: pagamento no Pix, nota nº…" value="${esc(st.note || '')}">
        </div>
      </div>
      ${!st.useImei && st.storage ? `
        <div class="summary-box">
          <div class="phone-ico">${icon('phone')}</div>
          <div class="grow"><strong>${st.qty}× ${esc(st.model)} ${esc(st.storage)}</strong><div class="muted" style="font-size:12.5px">${st.variant ? esc(st.variant.replace('|', ' · ')) : 'Cor indiferente'}</div></div>
          <span class="badge orange">Saída</span>
        </div>` : ''}
    `;
    m.$('[data-submit]').disabled = st.useImei ? false : !(st.model && st.storage && max > 0);
  }

  // Mantém os campos de texto entre re-renderizações
  const keepText = () => {
    st.reason = $('#w-reason', root)?.value || st.reason;
    st.customer = $('#w-customer', root)?.value ?? st.customer;
    st.note = $('#w-note', root)?.value ?? st.note;
    if ($('#w-imei', root)) st.imei = $('#w-imei', root).value;
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    keepText();
    if (b.dataset.mode) { st.useImei = b.dataset.mode === 'imei'; render(); }
    else if (b.dataset.storage !== undefined) { st.storage = b.dataset.storage; st.variant = ''; st.qty = 1; render(); }
    else if (b.dataset.variant !== undefined) { st.variant = b.dataset.variant; st.qty = 1; render(); }
    else if (b.dataset.qty) { st.qty = Math.min(maxQty(), Math.max(1, st.qty + Number(b.dataset.qty))); render(); }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-model]')) { keepText(); st.model = e.target.value; st.storage = ''; st.variant = ''; st.qty = 1; render(); }
    if (e.target.matches('[data-qty-input]')) { keepText(); st.qty = Math.min(maxQty(), Math.max(1, Math.floor(Number(e.target.value) || 1))); render(); }
  });

  m.$('[data-submit]').addEventListener('click', async (e) => {
    keepText();
    const body = { reason: st.reason || 'Venda', customer: st.customer || '', note: st.note || '' };
    if (st.useImei) {
      const imei = (st.imei || '').replace(/\D/g, '');
      if (imei.length !== 15) return toast('Informe um IMEI com 15 dígitos.', 'error');
      body.imei = imei;
    } else {
      const [color, condition] = st.variant ? st.variant.split('|') : ['', ''];
      Object.assign(body, { model: st.model, storage: st.storage, color, condition, qty: st.qty });
    }
    try {
      const r = await withLoading(e.currentTarget, () => api('/api/stock/out', { method: 'POST', body }));
      m.close();
      const it = r.movement.items[0];
      toast(`Saída registrada: ${r.movement.qty}× ${it.model} ${it.storage}`);
      onDone?.(r.movement);
    } catch (err) { toast(err.message, 'error'); }
  });

  render();
  return m;
}

// Alterar a própria senha
function openChangePassword() {
  const m = openModal({
    size: 'sm', title: 'Alterar senha', subtitle: 'Use pelo menos 6 caracteres.',
    body: `<form class="form-grid" style="grid-template-columns:1fr" data-form>
      <div class="field"><label>Senha atual</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label>Nova senha</label><input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></div>
      <div class="field"><label>Confirmar nova senha</label><input class="input" type="password" name="confirm" minlength="6" autocomplete="new-password" required></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>${icon('lock')}Salvar senha</button>`,
  });
  const submit = async () => {
    const f = Object.fromEntries(new FormData(m.$('[data-form]')));
    if (f.next !== f.confirm) return toast('As senhas não conferem.', 'error');
    try {
      await withLoading(m.$('[data-save]'), () => api('/api/me/password', { method: 'PUT', body: { current: f.current, next: f.next } }));
      m.close();
      toast('Senha alterada com sucesso.');
      $('[data-default-pw]')?.remove();
      document.dispatchEvent(new Event('password-changed'));
    } catch (err) { toast(err.message, 'error'); }
  };
  m.$('[data-save]').addEventListener('click', submit);
  m.$('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

// Página aberta direto do arquivo (duplo clique): o sistema precisa do servidor para funcionar
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;padding:24px">
        <div class="card card-pad" style="max-width:560px">
          <div class="confirm-ico">${icon('alert')}</div>
          <h2 style="font-size:22px;letter-spacing:-.02em">Abra o sistema pelo servidor</h2>
          <p class="text-2" style="margin:8px 0 18px">Este arquivo foi aberto direto do computador. O sistema precisa ser iniciado pelo terminal:</p>
          <ol class="text-2" style="padding-left:20px;display:grid;gap:8px">
            <li>Abra o terminal na pasta <span class="mono">estoque-cel</span></li>
            <li>Rode <span class="mono gold">npm start</span></li>
            <li>Abra no navegador o endereço que aparecer (ex.: <span class="mono gold">http://localhost:3000</span>)</li>
          </ol>
        </div>
      </div>`;
  });
}
