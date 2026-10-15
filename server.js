'use strict';
/*
 * Império Cell — Sistema de Estoque de iPhones
 * Servidor HTTP sem dependências externas (somente Node.js >= 18).
 *   npm start        → inicia em http://localhost:3000
 *   npm run demo     → inicia e, se o estoque estiver vazio, carrega dados de demonstração
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h

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

// ───────────────────────── Utilidades ─────────────────────────
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const monthKey = (d) => dayKey(d).slice(0, 7);
const round2 = (n) => Math.round(n * 100) / 100;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

function str(v, max = 120) { return typeof v === 'string' ? v.trim().slice(0, max) : (typeof v === 'number' ? String(v) : ''); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function money(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) bad('Valor monetário inválido.');
  return round2(n);
}
function normImei(v) { return String(v || '').replace(/\D/g, ''); }
function luhnOk(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function validateImei(imei) {
  if (!/^\d{15}$/.test(imei)) bad(`IMEI inválido: ${imei} (deve ter 15 dígitos).`);
  if (!luhnOk(imei)) bad(`IMEI inválido: ${imei} (dígito verificador não confere).`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function readEmail(v) {
  const e = str(v, 120).toLowerCase();
  if (!EMAIL_RE.test(e)) bad('Informe um e-mail válido.');
  return e;
}
const emailTaken = (email, exceptId) => db.users.some((u) => u.email === email && u.id !== exceptId);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6) bad('A senha deve ter pelo menos 6 caracteres.');
  if (pw.length > 100) bad('Senha muito longa.');
}

// ───────────────────────── Banco de dados (arquivo JSON) ─────────────────────────
let db;

function seed() {
  return {
    version: 1,
    settings: {
      storeName: 'Império Cell',
      joinCode: newJoinCode(),
      lowStock: 2,
      models: [...DEFAULT_MODELS],
      storages: [...DEFAULT_STORAGES],
      colors: [...DEFAULT_COLORS],
    },
    users: [], // o administrador é cadastrado no primeiro acesso (e-mail + senha)
    units: [],
    movements: [],
    logs: [],
  };
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function loadDb() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    for (const k of ['units', 'movements', 'logs', 'users']) db[k] ||= [];
    db.settings = { ...seed().settings, ...db.settings };
    migrateUsers();
    persist(); // grava campos novos (ex.: código da loja) para não mudarem a cada reinício
    // Backup automático diário (mantém os últimos 30)
    const bk = path.join(BACKUP_DIR, `db-${dayKey(new Date())}.json`);
    if (!fs.existsSync(bk)) fs.copyFileSync(DB_FILE, bk);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort().slice(0, -30);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } else {
    db = seed();
    persist();
  }
}

const newJoinCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não confundir
  return Array.from(crypto.randomBytes(6), (b) => abc[b % abc.length]).join('');
};

function migrateUsers() {
  const legacy = db.users.some((u) => u.username && !u.email);
  for (const u of db.users) {
    if (!u.email) u.email = `${u.username || u.id.slice(0, 8)}@imperiocell.local`;
    delete u.username;
    u.pending ??= false;
  }
  // Instalação antiga nunca usada (só usuários padrão, sem estoque): volta para o primeiro acesso
  if (legacy && db.users.every((u) => u.defaultPassword) && !db.units.length && !db.movements.length) db.users = [];
}

function log(user, action, detail) {
  db.logs.unshift({ id: uid(), at: now(), userId: user?.id || null, userName: user?.name || 'Sistema', action, detail });
  if (db.logs.length > 5000) db.logs.length = 5000;
}

const publicUser = ({ pass, inviteToken, ...rest }) => ({ ...rest, hasPassword: !!pass, hasLink: !!inviteToken });
const snap = (u) => ({ id: u.id, model: u.model, storage: u.storage, color: u.color, condition: u.condition, imei: u.imei, cost: u.cost, price: u.price });
function stripPrices(m) {
  const { value, cost, ...rest } = m;
  return { ...rest, items: m.items.map(({ cost: c, price, ...i }) => i) };
}
const describeItems = (items) => {
  const g = {};
  for (const i of items) { const k = `${i.model} ${i.storage} ${i.color}`; g[k] = (g[k] || 0) + 1; }
  return Object.entries(g).map(([k, n]) => `${n}× ${k}`).join(', ');
};
const imeiInUse = (imei, exceptId) => !!imei && db.units.some((u) => u.imei === imei && u.status !== 'saida' && u.id !== exceptId);

function readUnitFields(b, partial = false) {
  const out = {};
  const has = (k) => !partial || k in b;
  if (has('model')) { out.model = str(b.model, 60); if (!out.model) bad('Informe o modelo.'); }
  if (has('storage')) { out.storage = str(b.storage, 10); if (!out.storage) bad('Informe o armazenamento.'); }
  if (has('color')) { out.color = str(b.color, 40); if (!out.color) bad('Informe a cor.'); }
  if (has('condition')) { out.condition = str(b.condition, 20) || 'Novo'; if (!CONDITIONS.includes(out.condition)) bad('Condição inválida.'); }
  if (has('battery')) {
    if (b.battery === '' || b.battery == null) out.battery = null;
    else { const n = Math.round(num(b.battery)); if (!(n >= 0 && n <= 100)) bad('A saúde da bateria deve estar entre 0 e 100%.'); out.battery = n; }
  }
  if (has('cost')) out.cost = money(b.cost);
  if (has('price')) out.price = money(b.price);
  if (has('supplier')) out.supplier = str(b.supplier, 80);
  if (has('note')) out.note = str(b.note, 300);
  return out;
}

// ───────────────────────── Sessões ─────────────────────────
const sessions = new Map();
const loginAttempts = new Map();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// Cada área tem o seu próprio cookie: o admin e o colaborador podem estar conectados ao mesmo
// tempo (inclusive no mesmo navegador) sem que um derrube ou "assuma" a sessão do outro.
const COOKIE = { admin: 'sid_admin', colaborador: 'sid_colab' };
// A área vem do cabeçalho X-Area (chamadas da página) ou de ?area=admin (downloads por link)
const areaOf = (req, url) => (req.headers['x-area'] === 'admin' || url?.searchParams.get('area') === 'admin' ? 'admin' : 'colaborador');

function getSession(req, area) {
  const token = parseCookies(req)[COOKIE[area]];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.exp < Date.now() || s.area !== area) { sessions.delete(token); return null; }
  const user = db.users.find((u) => u.id === s.userId && u.active && !u.pending);
  if (!user || (area === 'admin' && user.role !== 'admin')) { sessions.delete(token); return null; }
  s.exp = Date.now() + SESSION_TTL;
  return { user, token };
}
function startSession(res, user, area) {
  if (area === 'admin' && user.role !== 'admin') area = 'colaborador';
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, area, exp: Date.now() + SESSION_TTL });
  const prev = res.getHeader('Set-Cookie');
  const cookie = `${COOKIE[area]}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
  return area;
}
const homeOf = (area) => (area === 'admin' ? '/admin' : '/colaborador');
function killSessions(userId) { for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t); }

// ───────────────────────── Roteador ─────────────────────────
const routes = [];
function route(method, pattern, access, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler });
}

// ── Autenticação
route('POST', '/api/login', 'public', ({ req, res, body }) => {
  const ip = req.socket.remoteAddress || '?';
  const a = loginAttempts.get(ip);
  if (a?.until > Date.now()) throw new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil((a.until - Date.now()) / 60000)} min.`);
  if (a?.until && a.until <= Date.now()) loginAttempts.delete(ip);

  const email = str(body.email, 120).toLowerCase();
  const user = db.users.find((u) => u.email === email);
  if (user && !user.pass) throw new HttpError(403, 'Você ainda não criou sua senha. Use o link de acesso enviado pelo administrador.');
  if (!user || !verifyPassword(body.password || '', user.pass)) {
    const n = (loginAttempts.get(ip)?.n || 0) + 1;
    loginAttempts.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    throw new HttpError(401, 'E-mail ou senha inválidos.');
  }
  if (user.pending) throw new HttpError(403, 'Seu cadastro ainda aguarda a aprovação do administrador.');
  if (!user.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');
  if (body.role === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Este usuário não tem acesso de administrador.');
  loginAttempts.delete(ip);

  const area = startSession(res, user, body.role === 'admin' ? 'admin' : (user.role === 'admin' && body.role !== 'colaborador' ? 'admin' : 'colaborador'));
  user.lastLogin = now();
  log(user, 'Login', `Entrou na área ${area === 'admin' ? 'do administrador' : 'do colaborador'}`);
  persist();
  return { user: publicUser(user), redirect: homeOf(area) };
});

// Primeiro acesso: cadastra o e-mail e a senha do administrador principal
route('GET', '/api/setup', 'public', () => ({ needsSetup: !db.users.length, storeName: db.settings.storeName }));

route('POST', '/api/setup', 'public', ({ res, body }) => {
  if (db.users.length) throw new HttpError(409, 'O administrador já foi cadastrado. Faça login.');
  const name = str(body.name, 60);
  if (!name) bad('Informe seu nome.');
  const email = readEmail(body.email);
  validatePassword(body.password);
  const u = { id: uid(), name, email, role: 'admin', pass: hashPassword(body.password), active: true, pending: false, defaultPassword: false, createdAt: now(), lastLogin: now() };
  db.users.push(u);
  log(u, 'Usuários', `Cadastrou o administrador principal (${email})`);
  persist();
  startSession(res, u, 'admin');
  return { user: publicUser(u), redirect: '/admin' };
});

// Solicitação de cadastro: a conta fica pendente até o administrador aprovar
const registerAttempts = new Map();
route('POST', '/api/register', 'public', ({ req, res, body }) => {
  if (!db.users.length) bad('O sistema ainda não foi configurado pelo administrador.');
  const ip = req.socket.remoteAddress || '?';
  const a = registerAttempts.get(ip);
  if (a && a.reset > Date.now() && a.n >= 5) throw new HttpError(429, 'Muitos cadastros em sequência. Tente novamente mais tarde.');
  const name = str(body.name, 60);
  if (!name) bad('Informe seu nome.');
  const email = readEmail(body.email);
  if (emailTaken(email)) bad('Este e-mail já está cadastrado.');
  validatePassword(body.password);
  const code = str(body.code, 20).toUpperCase().replace(/\s/g, '');
  if (code && code !== db.settings.joinCode) bad('Código da loja inválido. Confira com o administrador ou deixe em branco para solicitar aprovação.');
  registerAttempts.set(ip, a && a.reset > Date.now() ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: Date.now() + 3600000 });
  const approved = !!code;
  const u = { id: uid(), name, email, role: 'colaborador', pass: hashPassword(body.password), active: true, pending: !approved, defaultPassword: false, createdAt: now(), lastLogin: approved ? now() : null };
  db.users.push(u);
  log(u, 'Cadastro', approved ? `Cadastrou-se com o código da loja (${email})` : `Solicitou acesso ao sistema (${email})`);
  persist();
  if (!approved) return { ok: true, pending: true };
  startSession(res, u, 'colaborador');
  return { ok: true, pending: false, redirect: '/colaborador' };
});

route('POST', '/api/logout', 'public', ({ req, res }) => {
  const area = areaOf(req);
  const token = parseCookies(req)[COOKIE[area]];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE[area]}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return { ok: true };
});

// Quem já está conectado neste navegador (para a tela de login oferecer "continuar")
route('GET', '/api/sessions', 'public', ({ req }) => {
  const a = getSession(req, 'admin'), c = getSession(req, 'colaborador');
  return { admin: a ? { name: a.user.name, email: a.user.email } : null, colaborador: c ? { name: c.user.name, email: c.user.email } : null };
});

// Código da loja (admin): usado pelo colaborador no próprio cadastro para entrar direto
route('POST', '/api/settings/join-code', 'admin', ({ user }) => {
  db.settings.joinCode = newJoinCode();
  log(user, 'Configurações', 'Gerou um novo código da loja');
  persist();
  return { joinCode: db.settings.joinCode };
});

route('GET', '/api/me', 'any', ({ user }) => ({ user: publicUser(user) }));

route('PUT', '/api/me/password', 'any', ({ user, body, token }) => {
  if (!verifyPassword(body.current || '', user.pass)) bad('A senha atual está incorreta.');
  validatePassword(body.next);
  user.pass = hashPassword(body.next);
  user.defaultPassword = false;
  for (const [t, s] of sessions) if (s.userId === user.id && t !== token) sessions.delete(t);
  log(user, 'Senha', 'Alterou a própria senha');
  persist();
  return { ok: true };
});

// ── Configurações / catálogo
route('GET', '/api/settings', 'any', ({ user }) => {
  const { joinCode, ...rest } = db.settings;
  return { ...rest, ...(user.role === 'admin' ? { joinCode } : {}), conditions: CONDITIONS, reasons: REASONS };
});

route('PUT', '/api/settings', 'admin', ({ user, body }) => {
  const s = db.settings;
  const list = (v, max) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean))];
  if ('storeName' in body) s.storeName = str(body.storeName, 60) || s.storeName;
  if ('lowStock' in body) { const n = Math.floor(num(body.lowStock)); if (!(n >= 0 && n <= 999)) bad('Limite de estoque baixo inválido.'); s.lowStock = n; }
  if ('models' in body) { const v = list(body.models, 60); if (!v.length) bad('Cadastre ao menos um modelo.'); s.models = v; }
  if ('storages' in body) { const v = list(body.storages, 10); if (!v.length) bad('Cadastre ao menos uma capacidade.'); s.storages = v; }
  if ('publicUrl' in body) {
    const u = str(body.publicUrl, 200).replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(u)) bad('Endereço público inválido. Exemplo: https://estoque.minhaloja.com.br');
    s.publicUrl = u;
  }
  if ('colors' in body) { const v = list(body.colors, 40); if (!v.length) bad('Cadastre ao menos uma cor.'); s.colors = v; }
  log(user, 'Configurações', 'Atualizou as configurações do sistema');
  persist();
  return { ...s, conditions: CONDITIONS, reasons: REASONS };
});

// ── Estoque (colaborador + admin)
route('GET', '/api/stock/summary', 'any', () => {
  const groups = new Map();
  for (const u of db.units) {
    if (u.status !== 'disponivel') continue;
    const k = [u.model, u.storage, u.color, u.condition].join('|');
    const g = groups.get(k) || { model: u.model, storage: u.storage, color: u.color, condition: u.condition, qty: 0 };
    g.qty++;
    groups.set(k, g);
  }
  return { groups: [...groups.values()], lowStock: db.settings.lowStock };
});

// Seleciona as unidades disponíveis para um item do pedido (por IMEI ou por modelo/GB/cor/condição)
function pickUnits(spec, taken) {
  const imei = normImei(spec.imei);
  const model = str(spec.model, 60), storage = str(spec.storage, 10), color = str(spec.color, 40), condition = str(spec.condition, 20);
  if (imei) {
    const u = db.units.find((x) => x.imei === imei && x.status !== 'saida');
    if (!u) bad(`Nenhum aparelho em estoque com o IMEI ${imei}.`);
    if (u.status !== 'disponivel') bad(`O aparelho de IMEI ${imei} está ${STATUS_LABEL[u.status]} e não pode sair.`);
    if (taken.has(u.id)) bad(`O IMEI ${imei} aparece duas vezes no pedido.`);
    if ((model && u.model !== model) || (storage && u.storage !== storage)) bad(`Este IMEI pertence a um ${u.model} ${u.storage} ${u.color}, não ao modelo selecionado.`);
    return [u];
  }
  const qty = Math.floor(num(spec.qty));
  if (!(qty >= 1 && qty <= 500)) bad('Quantidade inválida.');
  if (!model || !storage) bad('Selecione o modelo e o armazenamento.');
  const pool = db.units
    .filter((u) => u.status === 'disponivel' && !taken.has(u.id) && u.model === model && u.storage === storage && (!color || u.color === color) && (!condition || u.condition === condition))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // FIFO: sai o mais antigo primeiro
  if (pool.length < qty) bad(`Estoque insuficiente de ${model} ${storage}${color ? ` ${color}` : ''}: há apenas ${pool.length} unidade(s) disponível(is).`);
  return pool.slice(0, qty);
}

route('POST', '/api/stock/out', 'any', ({ user, body }) => {
  const reason = str(body.reason, 40) || 'Venda';
  if (!REASONS.includes(reason)) bad('Motivo de saída inválido.');
  const customer = str(body.customer, 80);
  const note = str(body.note, 300);
  let units;

  if (user.role === 'admin' && Array.isArray(body.unitIds) && body.unitIds.length) {
    units = [...new Set(body.unitIds)].map((id) => db.units.find((u) => u.id === id));
    if (units.some((u) => !u)) bad('Aparelho não encontrado.');
    const out = units.find((u) => u.status === 'saida');
    if (out) bad(`O aparelho ${out.model} ${out.storage} já saiu do estoque.`);
  } else {
    // Um pedido pode ter vários itens (body.items) ou um único item (campos direto no body)
    const specs = Array.isArray(body.items) && body.items.length ? body.items : [body];
    if (specs.length > 50) bad('O pedido tem itens demais (máximo 50).');
    const taken = new Set();
    units = [];
    for (const spec of specs) for (const u of pickUnits(spec, taken)) { taken.add(u.id); units.push(u); }
  }

  const at = now();
  const mv = {
    id: uid(), type: 'saida', at, userId: user.id, userName: user.name, reason, customer, note,
    unitIds: units.map((u) => u.id), items: units.map(snap), qty: units.length,
    value: round2(units.reduce((s, u) => s + (u.price || 0), 0)),
    cost: round2(units.reduce((s, u) => s + (u.cost || 0), 0)),
    reverted: false,
  };
  for (const u of units) Object.assign(u, { status: 'saida', outAt: at, outMovementId: mv.id, updatedAt: at });
  db.movements.unshift(mv);
  log(user, 'Saída', `${reason}: ${describeItems(mv.items)}${customer ? ` — cliente ${customer}` : ''}`);
  persist();
  return { movement: user.role === 'admin' ? mv : stripPrices(mv) };
});

route('GET', '/api/my/movements', 'any', ({ user }) =>
  db.movements.filter((m) => m.userId === user.id && m.type === 'saida').slice(0, 60).map(stripPrices));

// ── Aparelhos (admin)
route('GET', '/api/units', 'admin', () => db.units);

route('POST', '/api/units', 'admin', ({ user, body }) => {
  const f = readUnitFields(body);
  const raw = (Array.isArray(body.imeis) ? body.imeis : []).map(normImei).filter(Boolean);
  const imeis = [...new Set(raw)];
  if (imeis.length !== raw.length) bad('Há IMEIs repetidos na lista.');
  imeis.forEach(validateImei);
  for (const i of imeis) if (imeiInUse(i)) bad(`O IMEI ${i} já está cadastrado no estoque.`);
  const qty = imeis.length || Math.floor(num(body.qty));
  if (!(qty >= 1 && qty <= 500)) bad('Quantidade inválida (1 a 500).');

  const at = now();
  const created = [];
  for (let i = 0; i < qty; i++) {
    const u = { id: uid(), ...f, imei: imeis[i] || '', status: 'disponivel', createdAt: at, updatedAt: at, createdBy: user.name, outAt: null, outMovementId: null };
    db.units.push(u);
    created.push(u);
  }
  const mv = {
    id: uid(), type: 'entrada', at, userId: user.id, userName: user.name,
    reason: str(body.reason, 40) || 'Compra', customer: f.supplier, note: f.note,
    unitIds: created.map((u) => u.id), items: created.map(snap), qty,
    value: round2(f.cost * qty), cost: round2(f.cost * qty), reverted: false,
  };
  db.movements.unshift(mv);
  log(user, 'Entrada', `${describeItems(mv.items)}${f.supplier ? ` — fornecedor ${f.supplier}` : ''}`);
  persist();
  return { units: created, movement: mv };
});

route('PUT', '/api/units/:id', 'admin', ({ user, params, body }) => {
  const u = db.units.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Aparelho não encontrado.');
  const f = readUnitFields(body, true);
  if ('imei' in body) {
    const imei = normImei(body.imei);
    if (imei) { validateImei(imei); if (imeiInUse(imei, u.id)) bad(`O IMEI ${imei} já está cadastrado no estoque.`); }
    f.imei = imei;
  }
  if ('status' in body && body.status !== u.status) {
    if (u.status === 'saida') bad('Este aparelho já saiu do estoque. Use o estorno da movimentação para devolvê-lo.');
    if (!EDITABLE_STATUSES.includes(body.status)) bad('Status inválido.');
    f.status = body.status;
  }
  Object.assign(u, f, { updatedAt: now() });
  log(user, 'Edição', `Editou ${u.model} ${u.storage} ${u.color}${u.imei ? ` (IMEI ${u.imei})` : ''}`);
  persist();
  return u;
});

route('POST', '/api/units/bulk', 'admin', ({ user, body }) => {
  const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
  const targets = db.units.filter((u) => ids.has(u.id));
  if (!targets.length) bad('Nenhum aparelho selecionado.');
  if (body.action === 'delete') {
    db.units = db.units.filter((u) => !ids.has(u.id));
    log(user, 'Exclusão', `Excluiu ${targets.length} aparelho(s): ${describeItems(targets)}`);
  } else if (body.action === 'status') {
    if (!EDITABLE_STATUSES.includes(body.value)) bad('Status inválido.');
    const editable = targets.filter((u) => u.status !== 'saida');
    for (const u of editable) Object.assign(u, { status: body.value, updatedAt: now() });
    log(user, 'Edição', `Alterou status de ${editable.length} aparelho(s) para ${STATUS_LABEL[body.value]}`);
  } else if (body.action === 'price') {
    const price = money(body.value);
    for (const u of targets) Object.assign(u, { price, updatedAt: now() });
    log(user, 'Edição', `Alterou preço de venda de ${targets.length} aparelho(s)`);
  } else bad('Ação inválida.');
  persist();
  return { ok: true, count: targets.length };
});

route('DELETE', '/api/units/:id', 'admin', ({ user, params }) => {
  const u = db.units.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Aparelho não encontrado.');
  db.units = db.units.filter((x) => x !== u);
  log(user, 'Exclusão', `Excluiu ${u.model} ${u.storage} ${u.color}${u.imei ? ` (IMEI ${u.imei})` : ''}`);
  persist();
  return { ok: true };
});

// ── Movimentações (admin)
route('GET', '/api/movements', 'admin', () => db.movements.slice(0, 5000));

route('POST', '/api/movements/:id/revert', 'admin', ({ user, params, body }) => {
  const m = db.movements.find((x) => x.id === params.id);
  if (!m) throw new HttpError(404, 'Movimentação não encontrada.');
  if (m.reverted) bad('Esta movimentação já foi estornada.');
  const at = now();

  if (m.type === 'saida') {
    const plan = m.items.map((it) => {
      const u = db.units.find((x) => x.id === it.id);
      if (u && (u.status !== 'saida' || u.outMovementId !== m.id)) bad(`O aparelho ${u.model} ${u.storage} já foi movimentado depois desta saída.`);
      if (!u && imeiInUse(it.imei)) bad(`O IMEI ${it.imei} já está no estoque novamente.`);
      return { u, it };
    });
    for (const { u, it } of plan) {
      if (u) Object.assign(u, { status: 'disponivel', outAt: null, outMovementId: null, updatedAt: at });
      else db.units.push({ ...it, battery: null, supplier: '', note: 'Restaurado por estorno', status: 'disponivel', createdAt: at, updatedAt: at, createdBy: user.name, outAt: null, outMovementId: null });
    }
  } else if (m.type === 'entrada') {
    const units = m.unitIds.map((id) => db.units.find((u) => u.id === id)).filter(Boolean);
    if (units.some((u) => u.status === 'saida')) bad('Não é possível estornar: parte dos aparelhos desta entrada já saiu do estoque.');
    const ids = new Set(units.map((u) => u.id));
    db.units = db.units.filter((u) => !ids.has(u.id));
  } else bad('Este tipo de movimentação não pode ser estornado.');

  Object.assign(m, { reverted: true, revertedAt: at, revertedBy: user.name });
  db.movements.unshift({
    id: uid(), type: 'estorno', at, userId: user.id, userName: user.name, refId: m.id, refType: m.type,
    reason: str(body.reason, 120) || `Estorno de ${m.type}`, customer: '', note: '',
    unitIds: m.unitIds, items: m.items, qty: m.qty, value: 0, cost: 0, reverted: false,
  });
  log(user, 'Estorno', `Estornou ${m.type} de ${new Date(m.at).toLocaleString('pt-BR')}: ${describeItems(m.items)}`);
  persist();
  return { ok: true };
});

// ── Dashboard (admin)
route('GET', '/api/dashboard', 'admin', () => {
  const inStock = db.units.filter((u) => u.status !== 'saida');
  const avail = inStock.filter((u) => u.status === 'disponivel');
  const outs = db.movements.filter((m) => m.type === 'saida' && !m.reverted);
  const today = dayKey(new Date());
  const month = monthKey(new Date());
  const sum = (arr, k) => round2(arr.reduce((s, x) => s + (x[k] || 0), 0));

  const outsToday = outs.filter((m) => dayKey(m.at) === today);
  const outsMonth = outs.filter((m) => monthKey(m.at) === month);

  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const ms = outs.filter((m) => dayKey(m.at) === k);
    series.push({ day: k, qty: ms.reduce((s, m) => s + m.qty, 0), value: sum(ms, 'value') });
  }
  const groupCount = (arr, keyFn) => {
    const g = {};
    for (const x of arr) { const k = keyFn(x); g[k] = (g[k] || 0) + 1; }
    return Object.entries(g).map(([key, qty]) => ({ key, qty })).sort((a, b) => b.qty - a.qty);
  };

  const combos = new Map();
  for (const u of db.units) {
    const k = `${u.model}|${u.storage}`;
    if (!combos.has(k)) combos.set(k, { model: u.model, storage: u.storage, qty: 0 });
    if (u.status === 'disponivel') combos.get(k).qty++;
  }
  const lowStock = [...combos.values()].filter((c) => c.qty <= db.settings.lowStock).sort((a, b) => a.qty - b.qty).slice(0, 12);

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
    today: { qty: outsToday.reduce((s, m) => s + m.qty, 0), value: sum(outsToday, 'value') },
    month: { qty: outsMonth.reduce((s, m) => s + m.qty, 0), value: sum(outsMonth, 'value'), profit: round2(sum(outsMonth, 'value') - sum(outsMonth, 'cost')) },
    series,
    byModel: groupCount(avail, (u) => u.model),
    byStorage: groupCount(avail, (u) => u.storage),
    byCondition: groupCount(avail, (u) => u.condition),
    lowStock,
    lowStockLimit: db.settings.lowStock,
    sellers: Object.values(sellers).sort((a, b) => b.qty - a.qty),
    topModels: Object.entries(soldModels).map(([key, qty]) => ({ key, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5),
    recent: db.movements.slice(0, 8),
  };
});

// ── Usuários (admin)
route('GET', '/api/users', 'admin', () => db.users.map((u) => ({ ...publicUser(u), inviteToken: u.inviteToken || null })));

route('POST', '/api/users', 'admin', ({ user, body }) => {
  const name = str(body.name, 60);
  const email = readEmail(body.email);
  const role = body.role === 'admin' ? 'admin' : 'colaborador';
  if (!name) bad('Informe o nome.');
  if (emailTaken(email)) bad('Este e-mail já está cadastrado.');
  if (body.password) validatePassword(body.password);
  const u = { id: uid(), name, email, role, pass: body.password ? hashPassword(body.password) : null, active: true, pending: false, defaultPassword: false, createdAt: now(), lastLogin: null };
  if (!u.pass) u.inviteToken = newToken(); // sem senha: já nasce com link de acesso
  db.users.push(u);
  log(user, 'Usuários', `Cadastrou ${email} (${role})`);
  persist();
  return publicUser(u);
});

route('PUT', '/api/users/:id', 'admin', ({ user, params, body }) => {
  const u = db.users.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  const otherAdmins = db.users.filter((x) => x.role === 'admin' && x.active && !x.pending && x.id !== u.id).length;
  if ('name' in body) { const n = str(body.name, 60); if (!n) bad('Informe o nome.'); u.name = n; }
  if ('email' in body) { const e = readEmail(body.email); if (emailTaken(e, u.id)) bad('Este e-mail já está cadastrado.'); u.email = e; }
  if ('role' in body) {
    const role = body.role === 'admin' ? 'admin' : 'colaborador';
    if (u.role === 'admin' && role !== 'admin' && !otherAdmins) bad('O sistema precisa de pelo menos um administrador ativo.');
    u.role = role;
  }
  if ('active' in body) {
    const active = !!body.active;
    if (!active && u.id === user.id) bad('Você não pode desativar a si mesmo.');
    if (!active && u.role === 'admin' && !otherAdmins) bad('O sistema precisa de pelo menos um administrador ativo.');
    u.active = active;
    if (!active) killSessions(u.id);
  }
  if (body.password) {
    validatePassword(body.password);
    u.pass = hashPassword(body.password);
    u.defaultPassword = false;
    if (u.id !== user.id) killSessions(u.id);
  }
  log(user, 'Usuários', `Atualizou o usuário ${u.email}`);
  persist();
  return publicUser(u);
});

// ── Link de acesso individual
const newToken = () => crypto.randomBytes(24).toString('base64url');
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // redes domésticas/loja (192.168.x.x) primeiro
  return out.sort((a, b) => (b.startsWith('192.168.') - a.startsWith('192.168.')));
}
route('GET', '/api/network', 'admin', () => ({
  port,
  publicUrl: db.settings.publicUrl || '',
  lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
}));

route('POST', '/api/users/:id/link', 'admin', ({ user, params }) => {
  const u = db.users.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  if (u.pending) bad('Aprove a solicitação antes de gerar o link.');
  const renewed = !!u.inviteToken;
  u.inviteToken = newToken();
  log(user, 'Usuários', `${renewed ? 'Gerou um novo' : 'Gerou o'} link de acesso de ${u.email}`);
  persist();
  return { inviteToken: u.inviteToken };
});

route('DELETE', '/api/users/:id/link', 'admin', ({ user, params }) => {
  const u = db.users.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  delete u.inviteToken;
  log(user, 'Usuários', `Revogou o link de acesso de ${u.email}`);
  persist();
  return { ok: true };
});

const byToken = (token) => {
  const u = token && db.users.find((x) => x.inviteToken === token);
  if (!u) throw new HttpError(404, 'Este link de acesso é inválido ou foi revogado. Peça um novo link ao administrador.');
  if (u.pending) throw new HttpError(403, 'Seu cadastro ainda aguarda a aprovação do administrador.');
  if (!u.active) throw new HttpError(403, 'Seu acesso está desativado. Fale com o administrador.');
  return u;
};

route('GET', '/api/invite/:token', 'public', ({ params }) => {
  const u = byToken(params.token);
  return { name: u.name, email: u.email, role: u.role, needsPassword: !u.pass, storeName: db.settings.storeName };
});

route('POST', '/api/invite/:token', 'public', ({ req, res, params, body }) => {
  const ip = req.socket.remoteAddress || '?';
  const a = loginAttempts.get(ip);
  if (a?.until > Date.now()) throw new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil((a.until - Date.now()) / 60000)} min.`);
  const u = byToken(params.token);
  if (!u.pass) {
    validatePassword(body.password);
    u.pass = hashPassword(body.password);
    log(u, 'Senha', 'Criou a senha pelo link de acesso');
  } else if (!verifyPassword(body.password || '', u.pass)) {
    const n = (a?.n || 0) + 1;
    loginAttempts.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    throw new HttpError(401, 'Senha incorreta.');
  }
  loginAttempts.delete(ip);
  const area = startSession(res, u, u.role === 'admin' ? 'admin' : 'colaborador');
  u.lastLogin = now();
  log(u, 'Login', 'Entrou pelo link de acesso');
  persist();
  return { redirect: homeOf(area) };
});

route('POST', '/api/users/:id/approve', 'admin', ({ user, params, body }) => {
  const u = db.users.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  if (!u.pending) bad('Este usuário já foi aprovado.');
  Object.assign(u, { pending: false, active: true, role: body.role === 'admin' ? 'admin' : 'colaborador' });
  log(user, 'Usuários', `Aprovou o acesso de ${u.email} como ${u.role}`);
  persist();
  return publicUser(u);
});

route('DELETE', '/api/users/:id', 'admin', ({ user, params }) => {
  const u = db.users.find((x) => x.id === params.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  if (u.id === user.id) bad('Você não pode excluir a si mesmo.');
  if (u.role === 'admin' && !db.users.some((x) => x.role === 'admin' && x.active && !x.pending && x.id !== u.id)) bad('O sistema precisa de pelo menos um administrador ativo.');
  db.users = db.users.filter((x) => x !== u);
  killSessions(u.id);
  log(user, 'Usuários', u.pending ? `Recusou a solicitação de ${u.email}` : `Excluiu o usuário ${u.email}`);
  persist();
  return { ok: true };
});

// ── Auditoria e backup (admin)
route('GET', '/api/logs', 'admin', () => db.logs.slice(0, 2000));

route('GET', '/api/backup', 'admin', ({ res, user }) => {
  const data = { ...db, users: db.users.map(publicUser), exportedAt: now() };
  log(user, 'Backup', 'Exportou backup completo');
  persist();
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="backup-estoque-${dayKey(new Date())}.json"`,
  });
  res.end(JSON.stringify(data, null, 2));
});

// ───────────────────────── HTTP ─────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
function sendFile(res, file, noCache = false) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-store' : 'no-cache' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Requisição muito grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) return sendJson(res, 404, { error: 'Rota não encontrada.' });
  const m = url.pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const sess = getSession(req, areaOf(req, url));
  if (r.access !== 'public') {
    if (!sess) return sendJson(res, 401, { error: 'Sessão expirada. Faça login novamente.' });
    if (r.access === 'admin' && sess.user.role !== 'admin') return sendJson(res, 403, { error: 'Acesso restrito ao administrador.' });
  }
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') return sendJson(res, 403, { error: 'Requisição recusada.' });
  const body = req.method === 'GET' ? {} : await readBody(req);
  const result = await r.handler({ req, res, url, params, body, user: sess?.user, token: sess?.token });
  if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
}

function handlePage(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { p = '/'; }
  const adminSess = getSession(req, 'admin');
  const colabSess = getSession(req, 'colaborador');
  if (p === '/' || p === '/index.html') return redirect(res, colabSess ? '/colaborador' : adminSess ? '/admin' : '/login');
  // A tela de login sempre abre: permite entrar com outra conta mesmo se alguém já estiver conectado
  if (p === '/login') return sendFile(res, path.join(PUBLIC_DIR, 'login.html'), true);
  if (/^\/acesso\/[\w-]+$/.test(p)) return sendFile(res, path.join(PUBLIC_DIR, 'acesso.html'), true);
  if (p === '/admin') return adminSess ? sendFile(res, path.join(PUBLIC_DIR, 'admin.html'), true) : redirect(res, '/login?area=admin');
  if (p === '/colaborador') {
    if (colabSess) return sendFile(res, path.join(PUBLIC_DIR, 'colaborador.html'), true);
    // Admin abrindo a "Visão do colaborador" pelo painel: cria a sessão da área do colaborador para ele
    if (adminSess && url.searchParams.get('admin') === '1') {
      startSession(res, adminSess.user, 'colaborador');
      return redirect(res, '/colaborador');
    }
    return redirect(res, '/login');
  }

  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || path.extname(file) === '.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Não encontrado');
  }
  sendFile(res, file);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else handlePage(req, res, url);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Erro interno do servidor.' : e.message });
    else res.end();
  }
});

// ───────────────────────── Dados de demonstração ─────────────────────────
function loadDemo() {
  if (db.units.length) { console.log('  (demo ignorada: já existem aparelhos cadastrados)'); return; }
  if (!db.users.length) {
    const mk = (name, email, role, pw) => ({ id: uid(), name, email, role, pass: hashPassword(pw), active: true, pending: false, defaultPassword: true, createdAt: now(), lastLogin: null });
    db.users.push(mk('Administrador', 'admin@imperiocell.com', 'admin', 'admin123'), mk('Colaborador', 'colaborador@imperiocell.com', 'colaborador', 'colab123'));
  }
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const imei = () => {
    let s = '35' + Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    for (let d = 0; d < 10; d++) if (luhnOk(s + d)) return s + d;
  };
  const catalog = [
    ['iPhone 13', ['128GB', '256GB'], ['Meia-noite', 'Estelar', 'Azul', 'Rosa'], 2900, 3599],
    ['iPhone 14', ['128GB', '256GB'], ['Meia-noite', 'Estelar', 'Roxo'], 3400, 4199],
    ['iPhone 14 Pro Max', ['256GB', '512GB'], ['Roxo-profundo', 'Preto-espacial', 'Dourado'], 5200, 6299],
    ['iPhone 15', ['128GB', '256GB'], ['Preto', 'Azul', 'Rosa', 'Verde'], 4300, 5199],
    ['iPhone 15 Pro', ['128GB', '256GB'], ['Titânio Natural', 'Titânio Azul', 'Titânio Preto'], 5600, 6799],
    ['iPhone 15 Pro Max', ['256GB', '512GB'], ['Titânio Natural', 'Titânio Branco'], 6400, 7699],
    ['iPhone 16', ['128GB', '256GB'], ['Ultramarino', 'Verde-acinzentado', 'Preto'], 5100, 6199],
    ['iPhone 16 Pro', ['256GB', '512GB'], ['Titânio Deserto', 'Titânio Natural'], 7200, 8599],
    ['iPhone 16 Pro Max', ['256GB', '512GB', '1TB'], ['Titânio Deserto', 'Titânio Preto'], 8100, 9699],
    ['iPhone 17', ['256GB'], ['Lavanda', 'Sálvia', 'Azul Névoa'], 6000, 7299],
    ['iPhone 17 Pro', ['256GB', '512GB'], ['Laranja Cósmico', 'Azul Profundo', 'Prateado'], 8300, 9999],
    ['iPhone 17 Pro Max', ['256GB', '512GB', '1TB', '2TB'], ['Laranja Cósmico', 'Azul Profundo'], 9200, 11499],
  ];
  const admin = db.users.find((u) => u.role === 'admin');
  const colab = db.users.find((u) => u.role === 'colaborador') || admin;
  for (const [model, storages, colors, cost, price] of catalog) {
    for (const storage of storages) {
      const n = 1 + Math.floor(Math.random() * 6);
      const bump = DEFAULT_STORAGES.indexOf(storage) * 600;
      const seminovo = Math.random() < 0.3;
      const daysAgo = 10 + Math.floor(Math.random() * 40);
      const at = new Date(Date.now() - daysAgo * 864e5).toISOString();
      const items = [];
      for (let i = 0; i < n; i++) {
        const u = {
          id: uid(), model, storage, color: rnd(colors), condition: seminovo ? 'Seminovo' : 'Novo',
          battery: seminovo ? 82 + Math.floor(Math.random() * 18) : 100,
          cost: (seminovo ? cost * 0.78 : cost) + bump, price: (seminovo ? price * 0.8 : price) + bump,
          supplier: rnd(['Distribuidora Alpha', 'TechImport', 'Mega Eletrônicos']), note: '', imei: imei(),
          status: 'disponivel', createdAt: at, updatedAt: at, createdBy: admin.name, outAt: null, outMovementId: null,
        };
        u.cost = round2(u.cost); u.price = round2(Math.round(u.price / 10) * 10 - 1);
        db.units.push(u); items.push(u);
      }
      db.movements.push({ id: uid(), type: 'entrada', at, userId: admin.id, userName: admin.name, reason: 'Compra', customer: items[0].supplier, note: '', unitIds: items.map((u) => u.id), items: items.map(snap), qty: n, value: round2(items.reduce((s, u) => s + u.cost, 0)), cost: round2(items.reduce((s, u) => s + u.cost, 0)), reverted: false });
    }
  }
  // Algumas saídas espalhadas nos últimos 30 dias
  const clients = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elisa Martins', 'Felipe Alves', 'Gabriela Dias', ''];
  const pool = db.units.slice().sort(() => Math.random() - 0.5).slice(0, Math.floor(db.units.length * 0.4));
  for (const u of pool) {
    const at = new Date(Date.now() - Math.floor(Math.random() * 29) * 864e5 - Math.floor(Math.random() * 8) * 36e5).toISOString();
    const who = Math.random() < 0.7 ? colab : admin;
    const mv = { id: uid(), type: 'saida', at, userId: who.id, userName: who.name, reason: Math.random() < 0.9 ? 'Venda' : 'Troca', customer: rnd(clients), note: '', unitIds: [u.id], items: [snap(u)], qty: 1, value: u.price, cost: u.cost, reverted: false };
    Object.assign(u, { status: 'saida', outAt: at, outMovementId: mv.id, updatedAt: at });
    db.movements.push(mv);
  }
  const some = db.units.filter((u) => u.status === 'disponivel').slice(0, 3);
  if (some[0]) some[0].status = 'reservado';
  if (some[1]) some[1].status = 'manutencao';
  db.movements.sort((a, b) => b.at.localeCompare(a.at));
  log(null, 'Demo', 'Dados de demonstração carregados');
  persist();
  console.log(`  ✓ Demo carregada: ${db.units.length} aparelhos`);
}

// ───────────────────────── Start ─────────────────────────
loadDb();
if (process.argv.includes('--demo')) loadDemo();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { persist(); } finally { process.exit(0); } });

// Verifica se a porta está livre em IPv4 E IPv6. No Windows outro programa pode ocupar só o
// IPv4 (0.0.0.0) e o Node ainda consegue abrir o IPv6 (::) — aí o navegador alterna entre os dois
// servidores e as páginas carregam sem CSS. Por isso testamos os dois antes de escolher a porta.
const net = require('node:net');
const probe = (p, host) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => resolve(e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL')); // sem IPv6 = ok
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(p, host);
});
async function findPort(start) {
  for (let p = start; p < start + 20; p++) {
    if ((await probe(p, '0.0.0.0')) && (await probe(p, '::'))) return p;
    console.log(`  ⚠  Porta ${p} já está em uso por outro programa, tentando ${p + 1}...`);
  }
  throw new Error('Nenhuma porta livre encontrada.');
}
let port = PORT;
findPort(PORT).then((p) => { port = p; server.listen(port); }).catch((e) => { console.error(e.message); process.exit(1); });
server.on('listening', () => {
  console.log('\n  ♛  Império Cell — Estoque de iPhones');
  console.log(`  ➜  Neste computador:  http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  ➜  Na rede da loja:   http://${ip}:${port}   (outros computadores e celulares no mesmo Wi-Fi)`);
  console.log('');
  if (!db.users.length) {
    console.log('  Primeiro acesso: abra o endereço acima e cadastre o e-mail e a senha do administrador.\n');
  } else if (db.users.some((u) => u.defaultPassword)) {
    console.log('  Acessos de demonstração (troque as senhas):');
    for (const u of db.users.filter((x) => x.defaultPassword)) console.log(`    ${u.role === 'admin' ? 'Administrador' : 'Colaborador  '} → ${u.email}`);
    console.log('    Senhas: admin123 (admin) / colab123 (colaborador)\n');
  }

});
