'use strict';
/* Tela do colaborador: consulta o estoque da loja e dá saída em pedidos (sem acesso a preços ou dashboard) */
const state = {
  me: null, settings: null, groups: [], lowStock: 2, myMoves: [],
  search: '', model: '', storage: '', view: 'lista',
  order: new Map(), // chave "modelo|GB|cor|condição" → { model, storage, color, condition, qty }
};
const keyOf = (g) => [g.model, g.storage, g.color, g.condition].join('|');
// Itens do pedido: por modelo (chave = grupo) ou aparelho exato escaneado (chave = "imei:<IMEI>", com foto)
const scannedIn = (g) => [...state.order.values()].filter((i) => i.imei && keyOf(i) === keyOf(g)).length;
const inOrder = (g) => (state.order.get(keyOf(g))?.qty || 0) + scannedIn(g);
const orderTotal = () => [...state.order.values()].reduce((s, i) => s + i.qty, 0);

hydrateIcons();
$('#themeBtn').addEventListener('click', toggleTheme);
$('#logoutBtn').addEventListener('click', logout);
$('#pwBtn').addEventListener('click', openChangePassword);
document.addEventListener('password-changed', () => { state.me.defaultPassword = false; });
$('#imeiBtn').addEventListener('click', () => {
  const m = openSaidaWizard({ groups: state.groups, settings: state.settings, onDone: afterOut });
  m.$('[data-mode="imei"]')?.click();
});
$('#refreshBtn').addEventListener('click', () => load().then(() => toast('Estoque atualizado.', 'info')));
$('#search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); renderStock(); });
$('#modelFilter').addEventListener('change', (e) => { state.model = e.target.value; renderStock(); });
$('#storageChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-storage]');
  if (!c) return;
  state.storage = state.storage === c.dataset.storage ? '' : c.dataset.storage;
  renderFilters();
  renderStock();
});
$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  $$('[data-view]', $('#viewSeg')).forEach((x) => x.classList.toggle('active', x === b));
  renderStock();
});
$('#orderFab').addEventListener('click', () => $('#orderCard').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('#clearOrder').addEventListener('click', () => { state.order.clear(); renderOrder(); renderStock(); });
$('#scanBtn').addEventListener('click', async () => {
  const r = await openImeiScanner({ title: 'Escanear IMEI do aparelho' });
  if (!r) return;
  const k = `imei:${r.imei}`;
  if (state.order.has(k)) return toast(`O IMEI ${r.imei} já está no pedido.`, 'error');
  let u;
  try { u = await api(`/api/stock/imei/${r.imei}`); } catch (err) { return toast(err.message, 'error'); }
  const g = state.groups.find((x) => keyOf(x) === keyOf(u));
  // Se o pedido já tinha esse modelo "por quantidade", o aparelho escaneado ocupa uma dessas vagas
  const byModel = state.order.get(keyOf(u));
  if (g && inOrder(g) >= g.qty) {
    if (byModel && byModel.qty > 0) { byModel.qty--; if (!byModel.qty) state.order.delete(keyOf(u)); }
    else return toast('Não há mais unidades disponíveis deste aparelho.', 'error');
  }
  state.order.set(k, { ...u, qty: 1, photo: r.photo });
  toast(`${u.model} ${u.storage} ${u.color} (IMEI ${r.imei}) adicionado ao pedido com foto.`);
  renderOrder();
  renderStock();
});

// Ações dentro da lista de estoque
$('#stock').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const g = state.groups.find((x) => keyOf(x) === add.dataset.add);
    const row = add.closest('[data-row]');
    const qty = Math.max(1, Math.floor(Number($('[data-q]', row)?.value) || 1));
    addToOrder(g, qty);
    return;
  }
  const step = e.target.closest('[data-step]');
  if (step) {
    const input = $('[data-q]', step.closest('[data-row]'));
    const max = Number(input.max) || 1;
    input.value = Math.min(max, Math.max(1, (Number(input.value) || 1) + Number(step.dataset.step)));
    return;
  }
  const open = e.target.closest('[data-open-model]');
  if (open) {
    state.model = open.dataset.openModel;
    state.storage = open.dataset.openStorage || '';
    state.view = 'lista';
    $$('[data-view]', $('#viewSeg')).forEach((x) => x.classList.toggle('active', x.dataset.view === 'lista'));
    renderFilters();
    renderStock();
  }
});

// Fotos do IMEI das minhas saídas
$('#myMoves').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-photos]');
  if (!b) return;
  try { showPhotos(await api(`/api/movements/${b.dataset.photos}/photos`)); } catch (err) { toast(err.message, 'error'); }
});
function showPhotos(list) {
  if (!list.length) return toast('Nenhuma foto encontrada para esta saída.', 'info');
  const m = openModal({
    size: 'lg', title: 'Fotos do IMEI', subtitle: plural(list.length, 'foto', 'fotos'),
    body: `<div class="photo-grid">${list.map((p) => `<figure data-src="${p.id}"><img src="${p.image}" alt="IMEI ${esc(p.imei)}"><figcaption class="mono">${esc(fmtImei(p.imei) || 'IMEI não informado')}</figcaption></figure>`).join('')}</div>`,
    foot: '<button class="btn btn-primary" data-close>Fechar</button>',
  });
  m.el.addEventListener('click', (e) => { const f = e.target.closest('figure'); if (f) openPhotoViewer(f.querySelector('img').src, f.querySelector('figcaption').textContent); });
}

// Ações dentro do pedido
$('#orderItems').addEventListener('click', (e) => {
  const img = e.target.closest('[data-view-photo]');
  if (img) return openPhotoViewer(img.src, img.dataset.viewPhoto);
  const b = e.target.closest('[data-o]');
  if (!b) return;
  const item = state.order.get(b.dataset.key);
  if (!item) return;
  const g = state.groups.find((x) => keyOf(x) === b.dataset.key);
  if (b.dataset.o === 'rm') state.order.delete(b.dataset.key);
  if (b.dataset.o === 'minus') { item.qty--; if (item.qty <= 0) state.order.delete(b.dataset.key); }
  if (b.dataset.o === 'plus') {
    if (!g || inOrder(g) >= g.qty) return toast(`Só há ${g?.qty || 0} unidade(s) disponível(is) deste aparelho.`, 'error');
    item.qty++;
  }
  renderOrder();
  renderStock();
});

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.order.size) return;
  const f = Object.fromEntries(new FormData(e.target));
  const entries = [...state.order.values()];
  const items = entries.map(({ model, storage, color, condition, qty, imei }) => (imei ? { imei } : { model, storage, color, condition, qty }));
  const photos = entries.filter((i) => i.imei && i.photo).map((i) => ({ imei: i.imei, image: i.photo }));
  const total = orderTotal();
  const ok = await confirmDialog({
    title: `Confirmar saída de ${plural(total, 'aparelho', 'aparelhos')}?`,
    message: `${entries.map((i) => `${i.qty}× <b>${esc(i.model)} ${esc(i.storage)}</b> ${esc(i.color)}${i.imei ? ` <span class="mono">· IMEI ${esc(i.imei)}</span>` : ''}`).join('<br>')}${photos.length ? `<br><br>${icon('camera')} ${plural(photos.length, 'foto anexada', 'fotos anexadas')} como comprovante` : ''}${f.customer ? `<br><br>Cliente: <b>${esc(f.customer)}</b>` : ''}`,
    confirmText: 'Confirmar saída', iconName: 'out',
  });
  if (!ok) return;
  try {
    const r = await withLoading($('#confirmBtn'), () => api('/api/stock/out', { method: 'POST', body: { items, photos, reason: f.reason, customer: f.customer, note: f.note } }));
    state.order.clear();
    e.target.reset();
    $('#o-reason').value = 'Venda';
    showReceipt(r.movement);
    if (r.photoError) toast(r.photoError, 'error');
    afterOut();
  } catch (err) { toast(err.message, 'error'); load(); }
});

function addToOrder(g, qty) {
  if (!g) return;
  const k = keyOf(g);
  const cur = state.order.get(k)?.qty || 0;
  const add = Math.min(qty, g.qty - inOrder(g));
  if (add <= 0) return toast('Todas as unidades deste aparelho já estão no pedido.', 'error');
  state.order.set(k, { model: g.model, storage: g.storage, color: g.color, condition: g.condition, qty: cur + add });
  if (matchMedia('(max-width: 1180px)').matches) toast(`${add}× ${g.model} ${g.storage} adicionado ao pedido.`, 'info');
  renderOrder();
  renderStock();
}

function afterOut() { load(); }

// Comprovante para separar os aparelhos
function showReceipt(m) {
  const g = {};
  for (const i of m.items) { const k = `${i.model}|${i.storage}|${i.color}|${i.condition}`; g[k] = g[k] || { ...i, n: 0, imeis: [] }; g[k].n++; if (i.imei) g[k].imeis.push(i.imei); }
  openModal({
    title: 'Saída registrada',
    subtitle: `${fmtDateTime(m.at)} · ${esc(m.reason)}${m.customer ? ` · ${esc(m.customer)}` : ''}`,
    body: `
      <div class="confirm-ico" style="background:var(--green-soft);color:var(--green)">${icon('check')}</div>
      <p class="text-2" style="margin-bottom:14px">Separe os aparelhos abaixo para o pedido:${m.photos ? ` <span class="photo-chip">${icon('camera')}${plural(m.photos, 'foto do IMEI salva', 'fotos do IMEI salvas')}</span>` : ''}</p>
      <div class="list" style="margin:0 -24px;border-top:1px solid var(--border)">
        ${Object.values(g).map((i) => `<div class="list-item">
          <div class="phone-ico">${icon('phone')}</div>
          <div class="grow"><strong>${esc(i.model)} · ${esc(i.storage)}</strong><small>${esc(i.color)} · ${esc(i.condition)}${i.imeis.length ? `<br><span class="mono">${i.imeis.map((x) => esc(fmtImei(x))).join('<br>')}</span>` : ''}</small></div>
          <b class="num" style="font-size:16px">${i.n}×</b>
        </div>`).join('')}
      </div>`,
    foot: '<button class="btn btn-primary" data-close>Concluído</button>',
  });
}

async function load() {
  try {
    const [me, settings, summary, moves] = await Promise.all([
      state.me ? { user: state.me } : api('/api/me'),
      state.settings ? state.settings : api('/api/settings'),
      api('/api/stock/summary'),
      api('/api/my/movements'),
    ]);
    state.me = me.user;
    state.settings = settings;
    state.groups = summary.groups;
    state.lowStock = summary.lowStock;
    state.myMoves = moves;
    // Ajusta o pedido se o estoque mudou (outro colaborador deu saída, por exemplo)
    for (const [k, item] of state.order) {
      const g = state.groups.find((x) => keyOf(x) === keyOf(item));
      if (!g) { state.order.delete(k); toast(`${item.model} ${item.storage} ${item.color} acabou e saiu do pedido.`, 'error'); continue; }
      if (item.imei) continue; // aparelho escaneado: a confirmação final checa se ainda está disponível
      const max = g.qty - scannedIn(g);
      if (item.qty > max) {
        if (max <= 0) state.order.delete(k); else item.qty = max;
        toast(`${item.model} ${item.storage}: só restam ${g.qty} unidade(s).`, 'error');
      }
    }
    render();
  } catch (err) { toast(err.message, 'error'); }
}

function render() {
  const u = state.me;
  $('#userName').textContent = u.name;
  $('#userRole').textContent = u.role === 'admin' ? 'Administrador' : 'Colaborador';
  $('#avatar').textContent = initials(u.name);
  $('#adminLink').classList.toggle('hidden', u.role !== 'admin');
  $('[data-store]').innerHTML = brandHtml(state.settings.storeName);
  const h = new Date().getHours();
  $('#hello').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${u.name.split(' ')[0]}`;
  if (!$('#o-reason').options.length) $('#o-reason').innerHTML = state.settings.reasons.map((r) => `<option ${r === 'Venda' ? 'selected' : ''}>${esc(r)}</option>`).join('');

  if (u.defaultPassword && !$('[data-default-pw]')) {
    $('.c-hero').insertAdjacentHTML('beforebegin', `<div class="banner" data-default-pw style="margin-top:24px;margin-bottom:-6px">${icon('alert')}<div class="grow">Você ainda está usando a senha padrão. Por segurança, altere sua senha.</div><button class="btn btn-sm" data-pw>Alterar agora</button></div>`);
    $('[data-pw]').addEventListener('click', openChangePassword);
  }

  const total = state.groups.reduce((s, g) => s + g.qty, 0);
  $('#totalUnits').textContent = fmtInt(total);
  $('#totalModels').textContent = fmtInt(new Set(state.groups.map((g) => g.model)).size);
  $('#totalVariants').textContent = fmtInt(new Set(state.groups.map((g) => `${g.model}|${g.storage}`)).size);
  const today = new Date().toDateString();
  $('#myToday').textContent = fmtInt(state.myMoves.filter((m) => !m.reverted && new Date(m.at).toDateString() === today).reduce((s, m) => s + m.qty, 0));
  $('#imeiBtn').disabled = total === 0;

  renderFilters();
  renderStock();
  renderOrder();
  renderMoves();
}

function renderFilters() {
  const mRank = modelRank(state.settings.models);
  const sRank = storageRank(state.settings.storages);
  const models = [...new Set(state.groups.map((g) => g.model))].sort((a, b) => mRank(b) - mRank(a));
  if (state.model && !models.includes(state.model)) state.model = '';
  $('#modelFilter').innerHTML = `<option value="">Todos os modelos</option>${models.map((m) => `<option ${m === state.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
  const storages = [...new Set(state.groups.map((g) => g.storage))].sort((a, b) => sRank(a) - sRank(b));
  if (state.storage && !storages.includes(state.storage)) state.storage = '';
  $('#storageChips').innerHTML = `<span class="label" style="align-self:center;margin-right:4px">Capacidade:</span>
    <button class="chip ${!state.storage ? 'active' : ''}" data-storage="">Todas</button>
    ${storages.map((s) => `<button class="chip ${s === state.storage ? 'active' : ''}" data-storage="${esc(s)}">${esc(s)}</button>`).join('')}`;
}

function filteredGroups() {
  const q = state.search;
  return state.groups.filter((g) =>
    (!state.model || g.model === state.model) &&
    (!state.storage || g.storage === state.storage) &&
    (!q || `${g.model} ${g.storage} ${g.color} ${g.condition}`.toLowerCase().includes(q)));
}

function renderStock() {
  const mRank = modelRank(state.settings.models);
  const sRank = storageRank(state.settings.storages);
  const groups = filteredGroups().sort((a, b) =>
    mRank(b.model) - mRank(a.model) || sRank(a.storage) - sRank(b.storage) || a.color.localeCompare(b.color) || a.condition.localeCompare(b.condition));

  if (!groups.length) {
    $('#stock').innerHTML = `<div class="empty"><div class="empty-ico">${icon(state.groups.length ? 'search' : 'box')}</div>
      <h4>${state.groups.length ? 'Nada encontrado' : 'Estoque vazio'}</h4>
      <p>${state.groups.length ? 'Tente outro termo de busca ou filtro.' : 'Nenhum iPhone disponível no momento. Assim que o administrador cadastrar uma entrada, ele aparece aqui.'}</p></div>`;
    return;
  }

  const byModel = new Map();
  for (const g of groups) { if (!byModel.has(g.model)) byModel.set(g.model, []); byModel.get(g.model).push(g); }

  if (state.view === 'cards') {
    $('#stock').innerHTML = `<div class="model-grid" style="padding:18px 22px 22px">${[...byModel.entries()].map(([model, gs], i) => {
      const st = new Map();
      for (const g of gs) { if (!st.has(g.storage)) st.set(g.storage, []); st.get(g.storage).push(g); }
      const total = gs.reduce((s, g) => s + g.qty, 0);
      return `<article class="card model-card" style="animation-delay:${Math.min(i, 12) * 35}ms;background:var(--bg-2)">
        <div class="mc-head">
          <div class="mc-ico">${icon('phone')}</div>
          <div><h3>${esc(model)}</h3><span class="muted" style="font-size:12px">${plural(st.size, 'capacidade', 'capacidades')}</span></div>
          <div class="mc-total"><strong>${total}</strong><small>unid.</small></div>
        </div>
        <div class="gb-rows">${[...st.entries()].map(([storage, list]) => {
          const qty = list.reduce((s, g) => s + g.qty, 0);
          const colors = list.map((g) => `${g.color} ${g.qty}`).join(' · ');
          return `<button class="gb-row" data-open-model="${esc(model)}" data-open-storage="${esc(storage)}" title="Ver ${esc(model)} ${esc(storage)} na lista">
            <span class="gb">${esc(storage)}</span><span class="colors">${esc(colors)}</span>
            <span class="qty ${qty <= state.lowStock ? 'low' : ''}">${qty}</span><span class="go">${icon('chevronRight')}</span></button>`;
        }).join('')}</div>
      </article>`;
    }).join('')}</div>`;
    return;
  }

  $('#stock').innerHTML = `<div class="table-wrap"><table class="table stock-table">
    <thead><tr><th>Capacidade</th><th>Cor</th><th>Condição</th><th class="center">Disponível</th><th class="right">Adicionar ao pedido</th></tr></thead>
    <tbody>${[...byModel.entries()].map(([model, gs]) => `
      <tr class="group-row"><td colspan="5"><div class="cell-model"><div class="phone-ico">${icon('phone')}</div><strong>${esc(model)}</strong><span class="badge plain">${gs.reduce((s, g) => s + g.qty, 0)} un.</span></div></td></tr>
      ${gs.map((g) => {
        const k = keyOf(g);
        const free = g.qty - inOrder(g);
        return `<tr data-row>
          <td><strong style="font-size:14px">${esc(g.storage)}</strong></td>
          <td>${esc(g.color)}</td>
          <td>${conditionBadge(g.condition)}</td>
          <td class="center"><span class="badge ${g.qty <= state.lowStock ? 'orange' : 'green'}">${g.qty}</span>${inOrder(g) ? `<div class="muted" style="font-size:11px;margin-top:3px">${inOrder(g)} no pedido</div>` : ''}</td>
          <td><div class="actions" style="align-items:center">
            ${free > 0 ? `
              <div class="qty-ctl sm">
                <button type="button" data-step="-1" aria-label="Diminuir">${icon('minus')}</button>
                <input type="number" data-q min="1" max="${free}" value="1" aria-label="Quantidade">
                <button type="button" data-step="1" aria-label="Aumentar">${icon('plus')}</button>
              </div>
              <button class="btn btn-sm btn-primary" data-add="${esc(k)}">${icon('plus')}Adicionar</button>`
            : '<span class="badge gold plain">Tudo no pedido</span>'}
          </div></td>
        </tr>`;
      }).join('')}`).join('')}
    </tbody></table></div>`;
}

function renderOrder() {
  const items = [...state.order.entries()];
  const total = orderTotal();
  $('#orderSub').textContent = total ? `${plural(total, 'aparelho', 'aparelhos')} · ${plural(items.length, 'item', 'itens')}` : 'Nenhum aparelho adicionado';
  $('#clearOrder').classList.toggle('hidden', !total);
  $('#confirmBtn').disabled = !total;
  $('#confirmBtn').innerHTML = `${icon('out')}${total ? `Confirmar saída · ${plural(total, 'aparelho', 'aparelhos')}` : 'Confirmar saída'}`;
  $('#orderItems').innerHTML = items.length ? `<div class="list">${items.map(([k, i]) => `
    <div class="list-item">
      ${i.photo ? `<img class="photo-thumb" src="${i.photo}" alt="Foto do IMEI" data-view-photo="IMEI ${esc(i.imei)}">` : `<div class="phone-ico">${icon('phone')}</div>`}
      <div class="grow"><strong title="${esc(i.model)}">${esc(i.model)}</strong><small><b class="text-2">${esc(i.storage)}</b> · ${esc(i.color)} · ${esc(i.condition)}${i.imei ? `<br><span class="mono">IMEI ${esc(fmtImei(i.imei))}</span>` : ''}</small></div>
      ${i.imei ? `<span class="photo-chip" title="Aparelho exato, lido pela câmera">${icon('camera')}1×</span>` : `
      <div class="qty-ctl sm">
        <button type="button" data-o="minus" data-key="${esc(k)}" aria-label="Diminuir">${icon('minus')}</button>
        <span class="qty-val">${i.qty}</span>
        <button type="button" data-o="plus" data-key="${esc(k)}" aria-label="Aumentar">${icon('plus')}</button>
      </div>`}
      <button class="btn btn-ghost btn-icon btn-sm" data-o="rm" data-key="${esc(k)}" title="Remover" aria-label="Remover">${icon('trash')}</button>
    </div>`).join('')}</div>`
    : `<div class="empty" style="padding:30px 20px"><div class="empty-ico">${icon('box')}</div><h4>Pedido vazio</h4><p>Use “Adicionar” na lista do estoque.</p></div>`;
  const fab = $('#orderFab');
  fab.classList.toggle('hidden', !total);
  fab.innerHTML = `${icon('box')}Pedido · ${plural(total, 'aparelho', 'aparelhos')}`;
}

function renderMoves() {
  const list = state.myMoves.slice(0, 25);
  $('#myMoves').innerHTML = list.length ? list.map((m) => {
    const label = describeOrder(m.items);
    return `<div class="list-item">
      <div class="mv-ico ${m.reverted ? 'estorno' : 'saida'}">${icon(m.reverted ? 'undo' : 'out')}</div>
      <div class="grow"><strong title="${esc(label)}">${esc(label)}</strong><small>${esc(m.reason)}${m.customer ? ` · ${esc(m.customer)}` : ''} · ${fmtRelative(m.at)}</small></div>
      ${m.photos ? `<button class="btn btn-ghost btn-sm" data-photos="${esc(m.id)}" title="Ver fotos do IMEI">${icon('camera')}${m.photos}</button>` : ''}
      ${m.reverted ? '<span class="badge violet">Estornada</span>' : ''}
    </div>`;
  }).join('') : `<div class="empty" style="padding:36px 20px"><div class="empty-ico">${icon('clock')}</div><h4>Sem saídas ainda</h4><p>Suas saídas aparecerão aqui.</p></div>`;
}

function describeOrder(items) {
  const g = {};
  for (const i of items) { const k = `${i.model} ${i.storage}`; g[k] = (g[k] || 0) + 1; }
  return Object.entries(g).map(([k, n]) => `${n}× ${k}`).join(', ');
}

load();
// Atualização automática a cada 30s enquanto a aba estiver visível (mantém o pedido em andamento)
// Tempo real: quando outro colaborador ou o admin mexe no estoque, a tela se atualiza sozinha
const canRefresh = () => !document.hidden && !$('.modal-backdrop') && !document.activeElement?.matches('#stock input, #orderForm input');
window.addEventListener('db-change', () => { if (canRefresh()) load(); });
setInterval(() => { if (canRefresh()) load(); }, 60000);
