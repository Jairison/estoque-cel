'use strict';
/* Tela de acesso: entrar, criar conta (solicitação) e primeiro acesso (cadastro do administrador) */
let role = new URLSearchParams(location.search).get('area') === 'admin' ? 'admin' : 'colaborador';
let sessions = { admin: null, colaborador: null };
let mode = 'login'; // login | register | setup | sent

$('#feats').innerHTML = [['barcode', 'Controle por IMEI'], ['shield', 'Acesso por perfil'], ['trend', 'Relatórios em tempo real']]
  .map(([i, t]) => `<span>${icon(i)}${t}</span>`).join('');
$('#year').textContent = new Date().getFullYear();
$('#themeBtn').innerHTML = themeIcon();
$('#themeBtn').addEventListener('click', toggleTheme);

const box = $('#authBox');

const field = (id, label, type, ic, attrs = '') => `
  <div class="field">
    <label for="${id}">${label}</label>
    <div class="input-icon" style="position:relative">${icon(ic)}
      <input class="input" id="${id}" name="${id}" type="${type}" ${attrs} ${type === 'password' ? 'style="padding-right:44px"' : ''}>
      ${type === 'password' ? `<button type="button" class="btn btn-ghost btn-icon btn-sm pw-toggle" data-pw-toggle aria-label="Mostrar senha">${icon('eye')}</button>` : ''}
    </div>
  </div>`;
const emailField = (auto = 'username') => field('email', 'E-mail', 'email', 'user', `autocomplete="${auto === 'username' ? 'username' : 'email'}" autocapitalize="none" spellcheck="false" placeholder="voce@exemplo.com" required`);
const errorBox = '<div class="login-error" id="authError" role="alert"></div>';
const link = (to, text) => `<button type="button" class="btn btn-ghost btn-sm" data-go="${to}" style="padding:0 6px;color:var(--gold)">${text}</button>`;

function render() {
  if (mode === 'login') {
    box.innerHTML = `
      <h1>Bem-vindo de volta</h1>
      <p class="lead">Entre com seu e-mail e senha cadastrados.</p>
      <form id="authForm" novalidate>
        <div class="seg" role="tablist" aria-label="Tipo de acesso">
          <button type="button" class="${role === 'colaborador' ? 'active' : ''}" data-role="colaborador" role="tab">${icon('user')}Colaborador</button>
          <button type="button" class="${role === 'admin' ? 'active' : ''}" data-role="admin" role="tab">${icon('crown')}Administrador</button>
        </div>
        ${emailField()}
        ${field('password', 'Senha', 'password', 'lock', 'autocomplete="current-password" placeholder="••••••••" required')}
        ${errorBox}
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading="Entrando...">Entrar</button>
        <p class="muted" style="text-align:center;font-size:13px">Ainda não tem acesso? ${link('register', 'Criar conta')}</p>
      </form>
      ${continueBox()}`;
  } else if (mode === 'register') {
    box.innerHTML = `
      <h1>Criar conta</h1>
      <p class="lead">Cadastre seu próprio e-mail e senha. Sua conta fica ligada ao estoque da loja.</p>
      <form id="authForm" novalidate>
        ${field('name', 'Nome completo', 'text', 'user', 'autocomplete="name" maxlength="60" placeholder="Seu nome" required')}
        ${emailField('email')}
        ${field('password', 'Senha', 'password', 'lock', 'autocomplete="new-password" minlength="6" placeholder="Mínimo 6 caracteres" required')}
        ${field('confirm', 'Confirmar senha', 'password', 'lock', 'autocomplete="new-password" minlength="6" placeholder="Repita a senha" required')}
        ${field('code', 'Código da loja <span class="muted">(opcional)</span>', 'text', 'crown', 'maxlength="20" autocapitalize="characters" spellcheck="false" placeholder="Ex.: K7M2QX" style="text-transform:uppercase;letter-spacing:.15em"')}
        <p class="hint" style="margin-top:-8px">Com o código fornecido pelo administrador, seu acesso é liberado na hora. Sem o código, o cadastro fica aguardando aprovação.</p>
        ${errorBox}
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading="Enviando...">Criar minha conta</button>
        <p class="muted" style="text-align:center;font-size:13px">Já tem cadastro? ${link('login', 'Entrar')}</p>
      </form>`;
  } else if (mode === 'setup') {
    box.innerHTML = `
      <span class="badge gold" style="margin-bottom:12px">${icon('sparkle')}Primeiro acesso</span>
      <h1>Configure o administrador</h1>
      <p class="lead">Cadastre o e-mail e a senha da conta principal. Ela terá controle total do sistema.</p>
      <form id="authForm" novalidate>
        ${field('name', 'Seu nome', 'text', 'user', 'autocomplete="name" maxlength="60" placeholder="Nome do administrador" required')}
        ${emailField('email')}
        ${field('password', 'Senha', 'password', 'lock', 'autocomplete="new-password" minlength="6" placeholder="Mínimo 6 caracteres" required')}
        ${field('confirm', 'Confirmar senha', 'password', 'lock', 'autocomplete="new-password" minlength="6" placeholder="Repita a senha" required')}
        ${errorBox}
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading="Configurando...">${icon('crown')}Criar administrador e entrar</button>
      </form>`;
  } else if (mode === 'sent') {
    box.innerHTML = `
      <div class="confirm-ico" style="background:var(--green-soft);color:var(--green)">${icon('check')}</div>
      <h1>Cadastro enviado!</h1>
      <p class="lead">Seu acesso foi solicitado. Assim que o administrador aprovar, você poderá entrar com seu e-mail e senha.</p>
      <button class="btn btn-primary btn-lg btn-block" data-go="login">Voltar para o login</button>`;
  }
  const first = $('input', box);
  if (first) setTimeout(() => first.focus(), 30);
}

function showError(msg) {
  const err = $('#authError');
  err.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
  err.classList.remove('show');
  void err.offsetWidth; // reinicia a animação
  err.classList.add('show');
}

box.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { mode = go.dataset.go; render(); return; }
  const r = e.target.closest('[data-role]');
  if (r) {
    role = r.dataset.role;
    $$('[data-role]', box).forEach((x) => x.classList.toggle('active', x === r));
    return;
  }
  const t = e.target.closest('[data-pw-toggle]');
  if (t) {
    const input = t.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.innerHTML = icon(show ? 'eyeOff' : 'eye');
    t.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  }
});

box.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = $('button[type=submit]', e.target);
  const email = (f.email || '').trim();
  if (mode !== 'login') {
    if (!f.name?.trim()) return showError('Informe seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Informe um e-mail válido.');
    if ((f.password || '').length < 6) return showError('A senha deve ter pelo menos 6 caracteres.');
    if (f.password !== f.confirm) return showError('As senhas não conferem.');
  } else if (!email || !f.password) return showError('Preencha e-mail e senha.');

  try {
    if (mode === 'login') {
      const r = await withLoading(btn, () => api('/api/login', { method: 'POST', body: { email, password: f.password, role } }));
      location.href = r.redirect;
    } else if (mode === 'setup') {
      const r = await withLoading(btn, () => api('/api/setup', { method: 'POST', body: { name: f.name, email, password: f.password } }));
      location.href = r.redirect;
    } else {
      const r = await withLoading(btn, () => api('/api/register', { method: 'POST', body: { name: f.name, email, password: f.password, code: (f.code || '').trim() } }));
      if (r.redirect) { location.href = r.redirect; return; }
      mode = 'sent';
      render();
    }
  } catch (ex) {
    showError(ex.message);
  }
});

// Contas já conectadas neste navegador: oferece continuar sem digitar a senha de novo
function continueBox() {
  const rows = [['colaborador', 'Área do colaborador', '/colaborador'], ['admin', 'Painel do administrador', '/admin']]
    .filter(([k]) => sessions[k]);
  if (!rows.length) return '';
  return `<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">
    <div class="label" style="margin-bottom:10px">Já conectado neste navegador</div>
    ${rows.map(([k, label, href]) => `<a class="user-card" href="${href}" style="margin-bottom:8px">
      <div class="avatar ${k === 'admin' ? '' : 'violet'}">${esc(initials(sessions[k].name))}</div>
      <div class="who"><strong>${esc(sessions[k].name)}</strong><small>${label}</small></div>${icon('chevronRight')}</a>`).join('')}
  </div>`;
}

// Descobre se é o primeiro acesso (nenhum usuário cadastrado ainda) e quem já está conectado
Promise.all([api('/api/setup'), api('/api/sessions').catch(() => sessions)])
  .then(([s, sess]) => { sessions = sess; if (s.needsSetup) mode = 'setup'; render(); })
  .catch(() => render());
