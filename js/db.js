/*
 * Império Cell — camada de dados (Firebase Authentication + Cloud Firestore)
 * Substitui o antigo servidor: as telas continuam chamando api('/api/...') e este módulo
 * executa cada operação direto no Firebase. A segurança é garantida pelas regras (firestore.rules).
 */
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updateProfile, sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, onSnapshot, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulator } from './firebase-config.js';

// ───────────────────────── Catálogo padrão ─────────────────────────
const DEFAULT_MODELS = [
  'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone SE (2ª geração)',
  'iPhone 12 mini', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone SE (3ª geração)',
  'iPhone 13 mini', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max',
  'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max',
  'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max',
  'iPhone 16e', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max',
  'iPhone 17', 'iPhone Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max',
];
const DEFAULT_STORAGES = ['64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
const DEFAULT_COLORS = [
  'Preto', 'Branco', 'Azul', 'Verde', 'Rosa', 'Roxo', 'Vermelho', 'Amarelo', 'Dourado', 'Prateado',
  'Grafite', 'Meia-noite', 'Estelar', 'Azul-sierra', 'Verde-alpino',
  'Titânio Natural', 'Titânio Preto', 'Titânio Branco', 'Titânio Azul', 'Titânio Deserto',
  'Ultramarino', 'Verde-acinzentado', 'Lavanda', 'Sálvia', 'Azul Névoa',
  'Laranja Cósmico', 'Azul Profundo', 'Azul-céu', 'Dourado-claro', 'Branco-nuvem', 'Preto-espacial',
];
const CONDITIONS = ['Novo', 'Seminovo', 'Vitrine', 'Recondicionado'];
const REASONS = ['Venda', 'Troca', 'Garantia', 'Transferência', 'Devolução ao fornecedor', 'Outro'];
const EDITABLE_STATUSES = ['disponivel', 'reservado', 'manutencao'];
const STATUS_LABEL = { disponivel: 'disponível', reservado: 'reservado', manutencao: 'em manutenção', saida: 'fora do estoque' };
const MAX_ENTRY = 200; // aparelhos por entrada (limite de gravação em lote do Firestore)

// ───────────────────────── Utilidades ─────────────────────────
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg) => { throw new ApiError(400, msg); };
const now = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const monthKey = (d) => dayKey(d).slice(0, 7);
const round2 = (n) => Math.round(n * 100) / 100;
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
function money(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) bad('Valor monetário inválido.');
  return round2(n);
}
const normImei = (v) => String(v || '').replace(/\D/g, '');
function luhnOk(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) { let d = Number(s[s.length - 1 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
function validateImei(imei) {
  if (!/^\d{15}$/.test(imei)) bad(`IMEI inválido: ${imei} (deve ter 15 dígitos).`);
  if (!luhnOk(imei)) bad(`IMEI inválido: ${imei} (dígito verificador não confere).`);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function readEmail(v) { const e = str(v, 120).toLowerCase(); if (!EMAIL_RE.test(e)) bad('Informe um e-mail válido.'); return e; }
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6) bad('A senha deve ter pelo menos 6 caracteres.');
  if (pw.length > 100) bad('Senha muito longa.');
}
const newJoinCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
};
const randomPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36)).join('').slice(0, 24) + 'Aa1!';
const describeItems = (items) => {
  const g = {};
  for (const i of items) { const k = `${i.model} ${i.storage} ${i.color}`; g[k] = (g[k] || 0) + 1; }
  return Object.entries(g).map(([k, n]) => `${n}× ${k}`).join(', ');
};
const snap = (u) => ({ id: u.id, model: u.model, storage: u.storage, color: u.color, condition: u.condition, imei: u.imei || '' });

// Mensagens do Firebase em português
function fbErr(e) {
  if (e instanceof ApiError) return e;
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': [401, 'E-mail ou senha inválidos.'],
    'auth/wrong-password': [401, 'E-mail ou senha inválidos.'],
    'auth/user-not-found': [401, 'E-mail ou senha inválidos.'],
    'auth/invalid-email': [400, 'Informe um e-mail válido.'],
    'auth/email-already-in-use': [400, 'Este e-mail já está cadastrado.'],
    'auth/weak-password': [400, 'A senha deve ter pelo menos 6 caracteres.'],
    'auth/too-many-requests': [429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    'auth/network-request-failed': [503, 'Sem conexão com a internet.'],
    'auth/requires-recent-login': [401, 'Por segurança, saia e entre novamente antes de trocar a senha.'],
    'auth/user-disabled': [403, 'Esta conta foi desativada.'],
    'auth/operation-not-allowed': [500, 'O login por e-mail e senha não está ativado no Firebase (Authentication → Método de login).'],
    'auth/configuration-not-found': [500, 'O login por e-mail e senha ainda não foi ativado no Firebase (Authentication → Vamos começar → E-mail/senha).'],
    'permission-denied': [403, 'Você não tem permissão para esta ação.'],
    'unavailable': [503, 'Sem conexão com o banco de dados. Verifique a internet.'],
    'failed-precondition': [500, 'O banco de dados (Firestore) ainda não foi criado no Firebase.'],
    'not-found': [500, 'O banco de dados (Firestore) ainda não foi criado no Firebase.'],
  };
  const [status, msg] = map[code] || [500, 'Erro inesperado. Tente novamente.'];
  if (!map[code]) console.error(e);
  return new ApiError(status, msg);
}
const wrap = (p) => p.catch((e) => { throw fbErr(e); });

// ───────────────────────── Firebase (uma instância por área) ─────────────────────────
// Admin e colaborador usam instâncias separadas: cada área tem a sua sessão, e um não derruba o outro.
const configured = !String(firebaseConfig.apiKey || '').includes('COLE');
const apps = {};
function fb(name, temp = false) {
  if (!apps[name]) {
    const app = initializeApp(firebaseConfig, name);
    // Instâncias temporárias ficam só na memória: não tocam nas sessões salvas no navegador
    const auth = temp ? initializeAuth(app, { persistence: inMemoryPersistence }) : getAuth(app);
    auth.languageCode = 'pt-BR';
    // No emulador local, o canal em tempo real pode travar; lá usamos long polling (só nos testes)
    const db = useEmulator ? initializeFirestore(app, { experimentalForceLongPolling: true }) : getFirestore(app);
    if (useEmulator) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    apps[name] = { name, app, auth, db };
  }
  return apps[name];
}
// Executa uma operação de login/cadastro numa sessão isolada, sem afetar quem já está conectado
async function withTempAuth(fn) {
  const name = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const c = fb(name, true);
  try { return await fn(c); }
  finally {
    await signOut(c.auth).catch(() => {});
    delete apps[name];
    deleteApp(c.app).catch(() => {});
  }
}
async function currentUser(c) { await c.auth.authStateReady(); return c.auth.currentUser; }

const PAGE_AREA = document.documentElement.dataset.area || 'colaborador';
const params = new URLSearchParams(location.search);
// "Visão do colaborador" aberta pelo admin usa a sessão do admin
const ADMIN_VIEW = PAGE_AREA === 'colaborador' && params.get('admin') === '1';
const AUTH_AREA = PAGE_AREA === 'admin' || ADMIN_VIEW ? 'admin' : 'colaborador';

let sess = null;
let sessLoading = null;
// Várias chamadas ao abrir a página compartilham a mesma verificação de sessão
function session() {
  if (sess) return Promise.resolve(sess);
  if (!sessLoading) sessLoading = loadSession().finally(() => { sessLoading = null; });
  return sessLoading;
}
async function loadSession() {
  const c = fb(AUTH_AREA);
  const fu = await currentUser(c);
  if (!fu) throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
  const s = await wrap(getDoc(doc(c.db, 'users', fu.uid)));
  if (!s.exists()) throw new ApiError(401, 'Conta não encontrada.');
  const me = { id: fu.uid, ...s.data(), hasPassword: true, hasLink: false, defaultPassword: false };
  if (me.status !== 'active' || (AUTH_AREA === 'admin' && me.role !== 'admin')) {
    if (!ADMIN_VIEW) await signOut(c.auth);
    throw new ApiError(401, 'Acesso não autorizado.');
  }
  sess = { ...c, fu, me };
  return sess;
}

// ── Cache em tempo real (onSnapshot): só documentos alterados são lidos de novo
const live = {};
let changeTimer;
function notifyChange() { clearTimeout(changeTimer); changeTimer = setTimeout(() => window.dispatchEvent(new Event('db-change')), 250); }
function watch(key, q) {
  if (live[key]) return live[key].ready;
  const entry = { map: new Map() };
  entry.ready = new Promise((resolve, reject) => {
    let first = true;
    entry.unsub = onSnapshot(q, (snapshot) => {
      for (const ch of snapshot.docChanges()) {
        if (ch.type === 'removed') entry.map.delete(ch.doc.id);
        else entry.map.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
      }
      if (first) { first = false; resolve(entry.map); } else notifyChange();
    }, (err) => { if (first) { first = false; reject(fbErr(err)); } else console.error(err); });
  });
  live[key] = entry;
  return entry.ready;
}
const isAdmin = (s) => s.me.role === 'admin';
const unitsMap = (s) => (isAdmin(s)
  ? watch('units', collection(s.db, 'units'))
  : watch('unitsAvail', query(collection(s.db, 'units'), where('status', '==', 'disponivel'))));
const pricesMap = (s) => watch('prices', collection(s.db, 'unitPrices'));
const movementsMap = (s) => watch('movements', collection(s.db, 'movements'));

async function loadSettings(c) {
  const s = await wrap(getDoc(doc(c.db, 'settings', 'public')));
  return { storeName: 'Império Cell', lowStock: 2, models: DEFAULT_MODELS, storages: DEFAULT_STORAGES, colors: DEFAULT_COLORS, ...(s.exists() ? s.data() : {}) };
}
const logRef = (c) => doc(collection(c.db, 'logs'));
const logData = (user, action, detail) => ({ at: now(), userId: user.id, userName: user.name, action, detail });
async function addLog(c, user, action, detail) {
  try { await setDoc(logRef(c), logData(user, action, detail)); } catch (e) { console.warn('Falha ao registrar auditoria', e); }
}

// Valores (custo/preço) de uma movimentação — saídas feitas pelo colaborador não guardam preço,
// então o admin calcula a partir da tabela de preços (unitPrices).
// trusted = movimentação gravada pelo admin (traz valores próprios). Nas saídas de colaborador
// os valores vêm SEMPRE da tabela de preços, nunca do que estiver gravado no documento.
function priceOf(prices, it, trusted = true) {
  const p = prices.get(it.id) || {};
  return trusted ? { cost: it.cost ?? p.cost ?? 0, price: it.price ?? p.price ?? 0 } : { cost: p.cost ?? 0, price: p.price ?? 0 };
}
function withValues(m, prices) {
  const trusted = m.value !== undefined;
  const items = (m.items || []).map((it) => ({ ...it, ...priceOf(prices, it, trusted) }));
  const value = m.value ?? (m.type === 'saida' ? round2(items.reduce((s, i) => s + i.price, 0)) : 0);
  const cost = m.cost ?? round2(items.reduce((s, i) => s + i.cost, 0));
  return { ...m, items, value, cost };
}

function readUnitFields(b, partial = false) {
  const pub = {}, priv = {};
  const has = (k) => !partial || k in b;
  if (has('model')) { pub.model = str(b.model, 60); if (!pub.model) bad('Informe o modelo.'); }
  if (has('storage')) { pub.storage = str(b.storage, 10); if (!pub.storage) bad('Informe o armazenamento.'); }
  if (has('color')) { pub.color = str(b.color, 40); if (!pub.color) bad('Informe a cor.'); }
  if (has('condition')) { pub.condition = str(b.condition, 20) || 'Novo'; if (!CONDITIONS.includes(pub.condition)) bad('Condição inválida.'); }
  if (has('battery')) {
    if (b.battery === '' || b.battery == null) pub.battery = null;
    else { const n = Math.round(num(b.battery)); if (!(n >= 0 && n <= 100)) bad('A saúde da bateria deve estar entre 0 e 100%.'); pub.battery = n; }
  }
  if (has('cost')) priv.cost = money(b.cost);
  if (has('price')) priv.price = money(b.price);
  if (has('supplier')) priv.supplier = str(b.supplier, 80);
  if (has('note')) priv.note = str(b.note, 300);
  return { pub, priv };
}

// ───────────────────────── Rotas ─────────────────────────
const routes = [];
function route(method, pattern, access, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler });
}

// ── Acesso
route('GET', '/api/setup', 'public', async () => {
  const c = fb('colaborador');
  const [owner, settings] = await Promise.all([wrap(getDoc(doc(c.db, 'meta', 'owner'))), loadSettings(c)]);
  return { needsSetup: !owner.exists(), storeName: settings.storeName };
});

route('POST', '/api/setup', 'public', async ({ body }) => {
  const c = fb('admin');
  if ((await wrap(getDoc(doc(c.db, 'meta', 'owner')))).exists()) throw new ApiError(409, 'O administrador já foi cadastrado. Faça login.');
  const name = str(body.name, 60);
  if (!name) bad('Informe seu nome.');
  const email = readEmail(body.email);
  validatePassword(body.password);
  const cred = await wrap(createUserWithEmailAndPassword(c.auth, email, body.password));
  await updateProfile(cred.user, { displayName: name });
  const uid = cred.user.uid, at = now();
  const me = { id: uid, name };
  const batch = writeBatch(c.db);
  batch.set(doc(c.db, 'meta', 'owner'), { uid, at });
  batch.set(doc(c.db, 'users', uid), { name, email, role: 'admin', status: 'active', createdAt: at, lastLogin: at });
  batch.set(doc(c.db, 'settings', 'public'), { storeName: 'Império Cell', lowStock: 2, models: DEFAULT_MODELS, storages: DEFAULT_STORAGES, colors: DEFAULT_COLORS });
  batch.set(doc(c.db, 'settings', 'private'), { joinCode: newJoinCode() });
  batch.set(logRef(c), logData(me, 'Usuários', `Cadastrou o administrador principal (${email})`));
  await wrap(batch.commit());
  return { redirect: 'admin.html' };
});

route('POST', '/api/login', 'public', async ({ body }) => {
  const area = body.role === 'admin' ? 'admin' : 'colaborador';
  const email = str(body.email, 120).toLowerCase();
  if (!email || !body.password) bad('Preencha e-mail e senha.');
  // 1) confere tudo numa sessão isolada (uma tentativa recusada não derruba quem já está conectado)
  const p = await withTempAuth(async (t) => {
    const cred = await wrap(signInWithEmailAndPassword(t.auth, email, body.password));
    const s = await wrap(getDoc(doc(t.db, 'users', cred.user.uid)));
    if (!s.exists()) throw new ApiError(403, 'Sua conta não está cadastrada nesta loja. Use "Criar conta".');
    const data = s.data();
    if (data.status === 'pending') throw new ApiError(403, 'Seu cadastro ainda aguarda a aprovação do administrador.');
    if (data.status !== 'active') throw new ApiError(403, 'Usuário desativado. Fale com o administrador.');
    if (area === 'admin' && data.role !== 'admin') throw new ApiError(403, 'Este usuário não tem acesso de administrador.');
    return data;
  });
  // 2) aprovado: entra de fato na área escolhida
  const c = fb(area);
  const cred = await wrap(signInWithEmailAndPassword(c.auth, email, body.password));
  sess = null;
  const me = { id: cred.user.uid, name: p.name };
  await wrap(updateDoc(doc(c.db, 'users', me.id), { lastLogin: now() }));
  await addLog(c, me, 'Login', `Entrou na área ${area === 'admin' ? 'do administrador' : 'do colaborador'}`);
  return { redirect: area === 'admin' ? 'admin.html' : 'colaborador.html' };
});

route('POST', '/api/register', 'public', async ({ body }) => {
  if (!(await wrap(getDoc(doc(fb('colaborador').db, 'meta', 'owner')))).exists()) bad('O sistema ainda não foi configurado pelo administrador.');
  const name = str(body.name, 60);
  if (!name) bad('Informe seu nome.');
  const email = readEmail(body.email);
  validatePassword(body.password);
  const code = str(body.code, 20).toUpperCase().replace(/\s/g, '');

  await withTempAuth(async (t) => {
    let user;
    try {
      user = (await createUserWithEmailAndPassword(t.auth, email, body.password)).user;
    } catch (e) {
      if (e?.code !== 'auth/email-already-in-use') throw fbErr(e);
      // Conta de login já existe (ex.: cadastro anterior interrompido): entra com a senha informada
      try { user = (await signInWithEmailAndPassword(t.auth, email, body.password)).user; }
      catch { throw new ApiError(400, 'Este e-mail já está cadastrado. Faça login ou use "Esqueci minha senha".'); }
      if ((await wrap(getDoc(doc(t.db, 'users', user.uid)))).exists()) bad('Este e-mail já está cadastrado. Faça login.');
    }
    await updateProfile(user, { displayName: name });
    const at = now();
    const data = { name, email, role: 'colaborador', status: code ? 'active' : 'pending', createdAt: at, lastLogin: code ? at : null };
    if (code) data.joinCode = code;
    try { await setDoc(doc(t.db, 'users', user.uid), data); }
    catch (e) {
      if (e?.code === 'permission-denied' && code) bad('Código da loja inválido. Confira com o administrador ou deixe em branco para solicitar aprovação.');
      throw fbErr(e);
    }
    await addLog(t, { id: user.uid, name }, 'Cadastro', code ? `Cadastrou-se com o código da loja (${email})` : `Solicitou acesso ao sistema (${email})`);
  });
  if (!code) return { ok: true, pending: true };
  await wrap(signInWithEmailAndPassword(fb('colaborador').auth, email, body.password));
  sess = null;
  return { ok: true, pending: false, redirect: 'colaborador.html' };
});

route('POST', '/api/forgot', 'public', async ({ body }) => {
  const email = readEmail(body.email);
  try { await sendPasswordResetEmail(fb('colaborador').auth, email); }
  catch (e) { if (!['auth/user-not-found'].includes(e?.code)) throw fbErr(e); }
  return { ok: true };
});

route('GET', '/api/sessions', 'public', async () => {
  const out = {};
  for (const area of ['admin', 'colaborador']) {
    const u = await currentUser(fb(area));
    out[area] = u ? { name: u.displayName || u.email, email: u.email } : null;
  }
  return out;
});

route('POST', '/api/logout', 'public', async () => {
  if (!ADMIN_VIEW) await signOut(fb(AUTH_AREA).auth);
  sess = null;
  return { redirect: ADMIN_VIEW ? 'admin.html' : PAGE_AREA === 'admin' ? 'index.html?area=admin' : 'index.html' };
});

route('GET', '/api/me', 'any', ({ s }) => ({ user: s.me }));

route('PUT', '/api/me/password', 'any', async ({ s, body }) => {
  validatePassword(body.next);
  try { await reauthenticateWithCredential(s.fu, EmailAuthProvider.credential(s.fu.email, body.current || '')); }
  catch (e) { if (['auth/invalid-credential', 'auth/wrong-password'].includes(e?.code)) bad('A senha atual está incorreta.'); throw fbErr(e); }
  await wrap(updatePassword(s.fu, body.next));
  await addLog(s, s.me, 'Senha', 'Alterou a própria senha');
  return { ok: true };
});

// ── Configurações
route('GET', '/api/settings', 'any', async ({ s }) => {
  const pub = await loadSettings(s);
  let joinCode;
  if (isAdmin(s)) { const p = await wrap(getDoc(doc(s.db, 'settings', 'private'))); joinCode = p.exists() ? p.data().joinCode : undefined; }
  return { ...pub, ...(joinCode ? { joinCode } : {}), conditions: CONDITIONS, reasons: REASONS };
});

route('PUT', '/api/settings', 'admin', async ({ s, body }) => {
  const cur = await loadSettings(s);
  const list = (v, max) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean))];
  const next = { storeName: cur.storeName, lowStock: cur.lowStock, models: cur.models, storages: cur.storages, colors: cur.colors };
  if ('storeName' in body) next.storeName = str(body.storeName, 60) || cur.storeName;
  if ('lowStock' in body) { const n = Math.floor(num(body.lowStock)); if (!(n >= 0 && n <= 999)) bad('Limite de estoque baixo inválido.'); next.lowStock = n; }
  if ('models' in body) { const v = list(body.models, 60); if (!v.length) bad('Cadastre ao menos um modelo.'); next.models = v; }
  if ('storages' in body) { const v = list(body.storages, 10); if (!v.length) bad('Cadastre ao menos uma capacidade.'); next.storages = v; }
  if ('colors' in body) { const v = list(body.colors, 40); if (!v.length) bad('Cadastre ao menos uma cor.'); next.colors = v; }
  const batch = writeBatch(s.db);
  batch.set(doc(s.db, 'settings', 'public'), next);
  batch.set(logRef(s), logData(s.me, 'Configurações', 'Atualizou as configurações do sistema'));
  await wrap(batch.commit());
  const p = await wrap(getDoc(doc(s.db, 'settings', 'private')));
  return { ...next, joinCode: p.exists() ? p.data().joinCode : undefined, conditions: CONDITIONS, reasons: REASONS };
});

route('POST', '/api/settings/join-code', 'admin', async ({ s }) => {
  const joinCode = newJoinCode();
  const batch = writeBatch(s.db);
  batch.set(doc(s.db, 'settings', 'private'), { joinCode }, { merge: true });
  batch.set(logRef(s), logData(s.me, 'Configurações', 'Gerou um novo código da loja'));
  await wrap(batch.commit());
  return { joinCode };
});

// ── Estoque (colaborador + admin)
route('GET', '/api/stock/summary', 'any', async ({ s }) => {
  const [units, settings] = await Promise.all([unitsMap(s), loadSettings(s)]);
  const groups = new Map();
  for (const u of units.values()) {
    if (u.status !== 'disponivel') continue;
    const k = [u.model, u.storage, u.color, u.condition].join('|');
    const g = groups.get(k) || { model: u.model, storage: u.storage, color: u.color, condition: u.condition, qty: 0 };
    g.qty++;
    groups.set(k, g);
  }
  return { groups: [...groups.values()], lowStock: settings.lowStock };
});

function pickUnits(units, spec, taken) {
  const imei = normImei(spec.imei);
  const model = str(spec.model, 60), storage = str(spec.storage, 10), color = str(spec.color, 40), condition = str(spec.condition, 20);
  if (imei) {
    const u = [...units.values()].find((x) => x.imei === imei && x.status !== 'saida');
    if (!u) bad(`Nenhum aparelho em estoque com o IMEI ${imei}.`);
    if (u.status !== 'disponivel') bad(`O aparelho de IMEI ${imei} está ${STATUS_LABEL[u.status]} e não pode sair.`);
    if (taken.has(u.id)) bad(`O IMEI ${imei} aparece duas vezes no pedido.`);
    if ((model && u.model !== model) || (storage && u.storage !== storage)) bad(`Este IMEI pertence a um ${u.model} ${u.storage} ${u.color}, não ao modelo selecionado.`);
    return [u];
  }
  const qty = Math.floor(num(spec.qty));
  if (!(qty >= 1 && qty <= 500)) bad('Quantidade inválida.');
  if (!model || !storage) bad('Selecione o modelo e o armazenamento.');
  const pool = [...units.values()]
    .filter((u) => u.status === 'disponivel' && !taken.has(u.id) && u.model === model && u.storage === storage && (!color || u.color === color) && (!condition || u.condition === condition))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // FIFO: sai o mais antigo primeiro
  if (pool.length < qty) bad(`Estoque insuficiente de ${model} ${storage}${color ? ` ${color}` : ''}: há apenas ${pool.length} unidade(s) disponível(is).`);
  return pool.slice(0, qty);
}

route('POST', '/api/stock/out', 'any', async ({ s, body }) => {
  const reason = str(body.reason, 40) || 'Venda';
  if (!REASONS.includes(reason)) bad('Motivo de saída inválido.');
  const customer = str(body.customer, 80), note = str(body.note, 300);
  const units = await unitsMap(s);
  let chosen;
  if (isAdmin(s) && Array.isArray(body.unitIds) && body.unitIds.length) {
    chosen = [...new Set(body.unitIds)].map((id) => units.get(id));
    if (chosen.some((u) => !u)) bad('Aparelho não encontrado.');
    const out = chosen.find((u) => u.status === 'saida');
    if (out) bad(`O aparelho ${out.model} ${out.storage} já saiu do estoque.`);
  } else {
    const specs = Array.isArray(body.items) && body.items.length ? body.items : [body];
    if (specs.length > 50) bad('O pedido tem itens demais (máximo 50).');
    const taken = new Set();
    chosen = [];
    for (const spec of specs) for (const u of pickUnits(units, spec, taken)) { taken.add(u.id); chosen.push(u); }
  }
  const at = now();
  const mvRef = doc(collection(s.db, 'movements'));
  const mv = {
    type: 'saida', at, userId: s.me.id, userName: s.me.name, reason, customer, note,
    unitIds: chosen.map((u) => u.id), items: chosen.map(snap), qty: chosen.length, reverted: false,
  };
  if (isAdmin(s)) {
    const prices = await pricesMap(s);
    mv.items = mv.items.map((it) => ({ ...it, ...priceOf(prices, it) }));
    mv.value = round2(mv.items.reduce((t, i) => t + i.price, 0));
    mv.cost = round2(mv.items.reduce((t, i) => t + i.cost, 0));
  }
  // Transação: garante que nenhum aparelho seja vendido duas vezes ao mesmo tempo
  await runTransaction(s.db, async (tx) => {
    const refs = chosen.map((u) => doc(s.db, 'units', u.id));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((sn, i) => {
      if (!sn.exists() || sn.data().status !== 'disponivel') bad(`O aparelho ${chosen[i].model} ${chosen[i].storage} ${chosen[i].color} acabou de sair do estoque. Atualize e tente de novo.`);
    });
    refs.forEach((r) => tx.update(r, { status: 'saida', outAt: at, outMovementId: mvRef.id, updatedAt: at }));
    tx.set(mvRef, mv);
  }).catch((e) => { throw fbErr(e); });
  await addLog(s, s.me, 'Saída', `${reason}: ${describeItems(mv.items)}${customer ? ` — cliente ${customer}` : ''}`);
  return { movement: { id: mvRef.id, ...mv } };
});

route('GET', '/api/my/movements', 'any', async ({ s }) => {
  const q = query(collection(s.db, 'movements'), where('userId', '==', s.me.id));
  const list = (await wrap(getDocs(q))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.type === 'saida');
  return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60).map(({ value, cost, ...m }) => ({ ...m, items: m.items.map(({ cost: c, price, ...i }) => i) }));
});

// ── Aparelhos (admin)
route('GET', '/api/units', 'admin', async ({ s }) => {
  const [units, prices] = await Promise.all([unitsMap(s), pricesMap(s)]);
  return [...units.values()].map((u) => ({ cost: 0, price: 0, supplier: '', note: '', ...u, ...(prices.get(u.id) || {}), id: u.id }));
});

route('POST', '/api/units', 'admin', async ({ s, body }) => {
  const { pub, priv } = readUnitFields(body);
  const units = await unitsMap(s);
  const raw = (Array.isArray(body.imeis) ? body.imeis : []).map(normImei).filter(Boolean);
  const imeis = [...new Set(raw)];
  if (imeis.length !== raw.length) bad('Há IMEIs repetidos na lista.');
  imeis.forEach(validateImei);
  for (const i of imeis) if ([...units.values()].some((u) => u.imei === i && u.status !== 'saida')) bad(`O IMEI ${i} já está cadastrado no estoque.`);
  const qty = imeis.length || Math.floor(num(body.qty));
  if (!(qty >= 1 && qty <= MAX_ENTRY)) bad(`Quantidade inválida (1 a ${MAX_ENTRY} por entrada).`);

  const at = now();
  const batch = writeBatch(s.db);
  const created = [];
  for (let i = 0; i < qty; i++) {
    const ref = doc(collection(s.db, 'units'));
    const u = { ...pub, imei: imeis[i] || '', status: 'disponivel', createdAt: at, updatedAt: at, createdBy: s.me.name, outAt: null, outMovementId: null };
    batch.set(ref, u);
    batch.set(doc(s.db, 'unitPrices', ref.id), priv);
    created.push({ id: ref.id, ...u, ...priv });
  }
  const mvRef = doc(collection(s.db, 'movements'));
  const mv = {
    type: 'entrada', at, userId: s.me.id, userName: s.me.name, reason: str(body.reason, 40) || 'Compra', customer: priv.supplier, note: priv.note,
    unitIds: created.map((u) => u.id), items: created.map((u) => ({ ...snap(u), cost: priv.cost, price: priv.price })), qty,
    value: round2(priv.cost * qty), cost: round2(priv.cost * qty), reverted: false,
  };
  batch.set(mvRef, mv);
  batch.set(logRef(s), logData(s.me, 'Entrada', `${describeItems(mv.items)}${priv.supplier ? ` — fornecedor ${priv.supplier}` : ''}`));
  await wrap(batch.commit());
  return { units: created, movement: { id: mvRef.id, ...mv } };
});

route('PUT', '/api/units/:id', 'admin', async ({ s, params, body }) => {
  const units = await unitsMap(s);
  const u = units.get(params.id);
  if (!u) throw new ApiError(404, 'Aparelho não encontrado.');
  const { pub, priv } = readUnitFields(body, true);
  if ('imei' in body) {
    const imei = normImei(body.imei);
    if (imei) { validateImei(imei); if ([...units.values()].some((x) => x.imei === imei && x.status !== 'saida' && x.id !== u.id)) bad(`O IMEI ${imei} já está cadastrado no estoque.`); }
    pub.imei = imei;
  }
  if ('status' in body && body.status !== u.status) {
    if (u.status === 'saida') bad('Este aparelho já saiu do estoque. Use o estorno da movimentação para devolvê-lo.');
    if (!EDITABLE_STATUSES.includes(body.status)) bad('Status inválido.');
    pub.status = body.status;
  }
  pub.updatedAt = now();
  const batch = writeBatch(s.db);
  batch.update(doc(s.db, 'units', u.id), pub);
  if (Object.keys(priv).length) batch.set(doc(s.db, 'unitPrices', u.id), priv, { merge: true });
  const after = { ...u, ...pub };
  batch.set(logRef(s), logData(s.me, 'Edição', `Editou ${after.model} ${after.storage} ${after.color}${after.imei ? ` (IMEI ${after.imei})` : ''}`));
  await wrap(batch.commit());
  const prices = await pricesMap(s);
  return { ...after, ...(prices.get(u.id) || {}), ...priv, id: u.id };
});

route('POST', '/api/units/bulk', 'admin', async ({ s, body }) => {
  const units = await unitsMap(s);
  const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
  const targets = [...units.values()].filter((u) => ids.has(u.id));
  if (!targets.length) bad('Nenhum aparelho selecionado.');
  if (targets.length > 240) bad('Selecione no máximo 240 aparelhos por vez.');
  const batch = writeBatch(s.db);
  if (body.action === 'delete') {
    for (const u of targets) { batch.delete(doc(s.db, 'units', u.id)); batch.delete(doc(s.db, 'unitPrices', u.id)); }
    batch.set(logRef(s), logData(s.me, 'Exclusão', `Excluiu ${targets.length} aparelho(s): ${describeItems(targets)}`));
  } else if (body.action === 'status') {
    if (!EDITABLE_STATUSES.includes(body.value)) bad('Status inválido.');
    const editable = targets.filter((u) => u.status !== 'saida');
    for (const u of editable) batch.update(doc(s.db, 'units', u.id), { status: body.value, updatedAt: now() });
    batch.set(logRef(s), logData(s.me, 'Edição', `Alterou status de ${editable.length} aparelho(s) para ${STATUS_LABEL[body.value]}`));
  } else if (body.action === 'price') {
    const price = money(body.value);
    for (const u of targets) batch.set(doc(s.db, 'unitPrices', u.id), { price }, { merge: true });
    batch.set(logRef(s), logData(s.me, 'Edição', `Alterou preço de venda de ${targets.length} aparelho(s)`));
  } else bad('Ação inválida.');
  await wrap(batch.commit());
  return { ok: true, count: targets.length };
});

route('DELETE', '/api/units/:id', 'admin', async ({ s, params }) => {
  const u = (await unitsMap(s)).get(params.id);
  if (!u) throw new ApiError(404, 'Aparelho não encontrado.');
  const batch = writeBatch(s.db);
  batch.delete(doc(s.db, 'units', u.id));
  batch.delete(doc(s.db, 'unitPrices', u.id));
  batch.set(logRef(s), logData(s.me, 'Exclusão', `Excluiu ${u.model} ${u.storage} ${u.color}${u.imei ? ` (IMEI ${u.imei})` : ''}`));
  await wrap(batch.commit());
  return { ok: true };
});

// ── Movimentações (admin)
route('GET', '/api/movements', 'admin', async ({ s }) => {
  const [movs, prices] = await Promise.all([movementsMap(s), pricesMap(s)]);
  return [...movs.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5000).map((m) => withValues(m, prices));
});

route('POST', '/api/movements/:id/revert', 'admin', async ({ s, params, body }) => {
  const [movs, units, prices] = await Promise.all([movementsMap(s), unitsMap(s), pricesMap(s)]);
  const m = movs.get(params.id);
  if (!m) throw new ApiError(404, 'Movimentação não encontrada.');
  if (m.reverted) bad('Esta movimentação já foi estornada.');
  if (m.items.length > 200) bad('Movimentação grande demais para estornar de uma vez.');
  const at = now();
  const batch = writeBatch(s.db);
  if (m.type === 'saida') {
    for (const it of m.items) {
      const u = units.get(it.id);
      if (u && (u.status !== 'saida' || u.outMovementId !== m.id)) bad(`O aparelho ${u.model} ${u.storage} já foi movimentado depois desta saída.`);
      if (!u && it.imei && [...units.values()].some((x) => x.imei === it.imei && x.status !== 'saida')) bad(`O IMEI ${it.imei} já está no estoque novamente.`);
    }
    for (const it of m.items) {
      const ref = doc(s.db, 'units', it.id);
      if (units.get(it.id)) batch.update(ref, { status: 'disponivel', outAt: null, outMovementId: null, updatedAt: at });
      else {
        const { cost, price } = priceOf(prices, it);
        batch.set(ref, { model: it.model, storage: it.storage, color: it.color, condition: it.condition, imei: it.imei || '', battery: null, status: 'disponivel', createdAt: at, updatedAt: at, createdBy: s.me.name, outAt: null, outMovementId: null });
        batch.set(doc(s.db, 'unitPrices', it.id), { cost, price, supplier: '', note: 'Restaurado por estorno' });
      }
    }
  } else if (m.type === 'entrada') {
    const list = m.unitIds.map((id) => units.get(id)).filter(Boolean);
    if (list.some((u) => u.status === 'saida')) bad('Não é possível estornar: parte dos aparelhos desta entrada já saiu do estoque.');
    for (const u of list) { batch.delete(doc(s.db, 'units', u.id)); batch.delete(doc(s.db, 'unitPrices', u.id)); }
  } else bad('Este tipo de movimentação não pode ser estornado.');
  batch.update(doc(s.db, 'movements', m.id), { reverted: true, revertedAt: at, revertedBy: s.me.name });
  batch.set(doc(collection(s.db, 'movements')), {
    type: 'estorno', at, userId: s.me.id, userName: s.me.name, refId: m.id, refType: m.type,
    reason: str(body.reason, 120) || `Estorno de ${m.type}`, customer: '', note: '',
    unitIds: m.unitIds, items: m.items, qty: m.qty, value: 0, cost: 0, reverted: false,
  });
  batch.set(logRef(s), logData(s.me, 'Estorno', `Estornou ${m.type} de ${new Date(m.at).toLocaleString('pt-BR')}: ${describeItems(m.items)}`));
  await wrap(batch.commit());
  return { ok: true };
});

// ── Dashboard (admin)
route('GET', '/api/dashboard', 'admin', async ({ s }) => {
  const [unitsM, prices, movs, settings] = await Promise.all([unitsMap(s), pricesMap(s), movementsMap(s), loadSettings(s)]);
  const units = [...unitsM.values()].map((u) => ({ ...u, cost: 0, price: 0, ...(prices.get(u.id) || {}) }));
  const inStock = units.filter((u) => u.status !== 'saida');
  const avail = inStock.filter((u) => u.status === 'disponivel');
  const outs = [...movs.values()].filter((m) => m.type === 'saida' && !m.reverted).map((m) => withValues(m, prices));
  const today = dayKey(new Date()), month = monthKey(new Date());
  const sum = (arr, k) => round2(arr.reduce((t, x) => t + (x[k] || 0), 0));
  const outsToday = outs.filter((m) => dayKey(m.at) === today);
  const outsMonth = outs.filter((m) => monthKey(m.at) === month);
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const ms = outs.filter((m) => dayKey(m.at) === k);
    series.push({ day: k, qty: ms.reduce((t, m) => t + m.qty, 0), value: sum(ms, 'value') });
  }
  const groupCount = (arr, keyFn) => {
    const g = {};
    for (const x of arr) { const k = keyFn(x); g[k] = (g[k] || 0) + 1; }
    return Object.entries(g).map(([key, qty]) => ({ key, qty })).sort((a, b) => b.qty - a.qty);
  };
  const combos = new Map();
  for (const u of units) {
    const k = `${u.model}|${u.storage}`;
    if (!combos.has(k)) combos.set(k, { model: u.model, storage: u.storage, qty: 0 });
    if (u.status === 'disponivel') combos.get(k).qty++;
  }
  const lowStock = [...combos.values()].filter((c) => c.qty <= settings.lowStock).sort((a, b) => a.qty - b.qty).slice(0, 12);
  const sellers = {};
  for (const m of outsMonth) {
    sellers[m.userName] ||= { name: m.userName, qty: 0, value: 0 };
    sellers[m.userName].qty += m.qty;
    sellers[m.userName].value = round2(sellers[m.userName].value + m.value);
  }
  const soldModels = {};
  for (const m of outsMonth) for (const it of m.items) soldModels[it.model] = (soldModels[it.model] || 0) + 1;
  return {
    available: avail.length,
    reserved: inStock.filter((u) => u.status === 'reservado').length,
    maintenance: inStock.filter((u) => u.status === 'manutencao').length,
    inStock: inStock.length,
    stockCost: sum(inStock, 'cost'),
    stockValue: sum(inStock, 'price'),
    today: { qty: outsToday.reduce((t, m) => t + m.qty, 0), value: sum(outsToday, 'value') },
    month: { qty: outsMonth.reduce((t, m) => t + m.qty, 0), value: sum(outsMonth, 'value'), profit: round2(sum(outsMonth, 'value') - sum(outsMonth, 'cost')) },
    series,
    byModel: groupCount(avail, (u) => u.model),
    byStorage: groupCount(avail, (u) => u.storage),
    byCondition: groupCount(avail, (u) => u.condition),
    lowStock,
    lowStockLimit: settings.lowStock,
    sellers: Object.values(sellers).sort((a, b) => b.qty - a.qty),
    topModels: Object.entries(soldModels).map(([key, qty]) => ({ key, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5),
    recent: [...movs.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((m) => withValues(m, prices)),
  };
});

// ── Usuários (admin)
const userOut = (d) => ({ id: d.id, ...d.data(), hasPassword: true, hasLink: false, defaultPassword: false, pending: d.data().status === 'pending', active: d.data().status === 'active' });
async function allUsers(s) { return (await wrap(getDocs(collection(s.db, 'users')))).docs.map(userOut); }

route('GET', '/api/users', 'admin', async ({ s }) => allUsers(s));

route('POST', '/api/users', 'admin', async ({ s, body }) => {
  const name = str(body.name, 60);
  if (!name) bad('Informe o nome.');
  const email = readEmail(body.email);
  const role = body.role === 'admin' ? 'admin' : 'colaborador';
  if (body.password) validatePassword(body.password);
  // Sessão isolada para criar a conta sem desconectar o administrador
  const uid = await withTempAuth(async (t) => {
    try {
      const cred = await createUserWithEmailAndPassword(t.auth, email, body.password || randomPassword());
      await updateProfile(cred.user, { displayName: name });
      return cred.user.uid;
    } catch (e) {
      if (e?.code === 'auth/email-already-in-use') bad('Este e-mail já tem uma conta. Peça para a pessoa entrar em "Criar conta" com o código da loja, usando a senha dela.');
      throw fbErr(e);
    }
  });
  const data = { name, email, role, status: 'active', createdAt: now(), lastLogin: null };
  const batch = writeBatch(s.db);
  batch.set(doc(s.db, 'users', uid), data);
  batch.set(logRef(s), logData(s.me, 'Usuários', `Cadastrou ${email} (${role})`));
  await wrap(batch.commit());
  let invited = false;
  if (!body.password) { await wrap(sendPasswordResetEmail(s.auth, email)); invited = true; }
  return { id: uid, ...data, active: true, pending: false, hasPassword: !!body.password, invited };
});

route('PUT', '/api/users/:id', 'admin', async ({ s, params, body }) => {
  const users = await allUsers(s);
  const u = users.find((x) => x.id === params.id);
  if (!u) throw new ApiError(404, 'Usuário não encontrado.');
  const otherAdmins = users.filter((x) => x.role === 'admin' && x.active && x.id !== u.id).length;
  const patch = {};
  if ('name' in body) { const n = str(body.name, 60); if (!n) bad('Informe o nome.'); patch.name = n; }
  if ('email' in body && str(body.email, 120).toLowerCase() !== u.email) bad('O e-mail de login não pode ser alterado. Cadastre um novo usuário com o e-mail correto.');
  if (body.password) bad('A senha de outra pessoa não pode ser definida pelo admin. Use "Enviar e-mail de senha".');
  if ('role' in body) {
    const role = body.role === 'admin' ? 'admin' : 'colaborador';
    if (u.role === 'admin' && role !== 'admin' && !otherAdmins) bad('O sistema precisa de pelo menos um administrador ativo.');
    patch.role = role;
  }
  if ('active' in body) {
    if (!body.active && u.id === s.me.id) bad('Você não pode desativar a si mesmo.');
    if (!body.active && u.role === 'admin' && !otherAdmins) bad('O sistema precisa de pelo menos um administrador ativo.');
    patch.status = body.active ? 'active' : 'disabled';
  }
  const batch = writeBatch(s.db);
  batch.update(doc(s.db, 'users', u.id), patch);
  batch.set(logRef(s), logData(s.me, 'Usuários', `Atualizou o usuário ${u.email}`));
  await wrap(batch.commit());
  if (u.id === s.me.id) sess = null;
  return { ...u, ...patch, active: (patch.status || u.status) === 'active' };
});

route('POST', '/api/users/:id/approve', 'admin', async ({ s, params, body }) => {
  const u = (await allUsers(s)).find((x) => x.id === params.id);
  if (!u) throw new ApiError(404, 'Usuário não encontrado.');
  if (!u.pending) bad('Este usuário já foi aprovado.');
  const role = body.role === 'admin' ? 'admin' : 'colaborador';
  const batch = writeBatch(s.db);
  batch.update(doc(s.db, 'users', u.id), { status: 'active', role });
  batch.set(logRef(s), logData(s.me, 'Usuários', `Aprovou o acesso de ${u.email} como ${role}`));
  await wrap(batch.commit());
  return { ...u, status: 'active', role, pending: false, active: true };
});

route('POST', '/api/users/:id/reset', 'admin', async ({ s, params }) => {
  const u = (await allUsers(s)).find((x) => x.id === params.id);
  if (!u) throw new ApiError(404, 'Usuário não encontrado.');
  await wrap(sendPasswordResetEmail(s.auth, u.email));
  await addLog(s, s.me, 'Usuários', `Enviou e-mail de senha para ${u.email}`);
  return { ok: true };
});

route('DELETE', '/api/users/:id', 'admin', async ({ s, params }) => {
  const users = await allUsers(s);
  const u = users.find((x) => x.id === params.id);
  if (!u) throw new ApiError(404, 'Usuário não encontrado.');
  if (u.id === s.me.id) bad('Você não pode excluir a si mesmo.');
  if (u.role === 'admin' && !users.some((x) => x.role === 'admin' && x.active && x.id !== u.id)) bad('O sistema precisa de pelo menos um administrador ativo.');
  const batch = writeBatch(s.db);
  batch.delete(doc(s.db, 'users', u.id));
  batch.set(logRef(s), logData(s.me, 'Usuários', u.pending ? `Recusou a solicitação de ${u.email}` : `Excluiu o usuário ${u.email}`));
  await wrap(batch.commit());
  return { ok: true };
});

// ── Auditoria e backup (admin)
route('GET', '/api/logs', 'admin', async ({ s }) =>
  (await wrap(getDocs(query(collection(s.db, 'logs'), orderBy('at', 'desc'), limit(1000))))).docs.map((d) => ({ id: d.id, ...d.data() })));

route('GET', '/api/backup', 'admin', async ({ s }) => {
  const [units, movements, users, settings, logs] = await Promise.all([
    routeCall('GET', '/api/units'), routeCall('GET', '/api/movements'), allUsers(s), loadSettings(s), routeCall('GET', '/api/logs'),
  ]);
  await addLog(s, s.me, 'Backup', 'Exportou backup completo');
  return { exportedAt: now(), settings, users, units, movements, logs };
});

// ───────────────────────── Despacho ─────────────────────────
async function routeCall(method, path, body = {}) {
  if (!configured) throw new ApiError(503, 'O Firebase ainda não foi configurado (js/firebase-config.js).');
  const clean = path.split('?')[0];
  const r = routes.find((x) => x.method === method && x.re.test(clean));
  if (!r) throw new ApiError(404, 'Operação não encontrada.');
  const m = clean.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  let s;
  if (r.access !== 'public') {
    s = await session();
    if (r.access === 'admin' && s.me.role !== 'admin') throw new ApiError(403, 'Acesso restrito ao administrador.');
  }
  return r.handler({ s, params, body: body || {} });
}

window.DB = { call: routeCall, configured };

// Enquanto o Firebase não for configurado, explica o que falta em vez de mostrar erros
if (!configured) {
  const show = () => {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;padding:24px">
        <div class="card card-pad" style="max-width:600px">
          <div class="confirm-ico">${typeof icon === 'function' ? icon('database') : ''}</div>
          <h2 style="font-size:22px;letter-spacing:-.02em">Falta conectar o Firebase</h2>
          <p class="text-2" style="margin:8px 0 14px">O sistema já está publicado, mas ainda não foi ligado ao banco de dados da loja.
          Preencha o arquivo <span class="mono gold">js/firebase-config.js</span> com os dados do seu projeto Firebase.</p>
          <p class="muted" style="font-size:12.5px">O passo a passo está no README do repositório.</p>
        </div>
      </div>`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
}
window.__dbResolve?.();
