'use strict';
/* Acesso pelo link individual: cria a senha no primeiro acesso, depois só pede a senha */
const token = location.pathname.split('/').pop();
const box = $('#authBox');
$('#year').textContent = new Date().getFullYear();
$('#themeBtn').innerHTML = themeIcon();
$('#themeBtn').addEventListener('click', toggleTheme);

const pwField = (id, label, auto, placeholder) => `
  <div class="field">
    <label for="${id}">${label}</label>
    <div class="input-icon" style="position:relative">${icon('lock')}
      <input class="input" id="${id}" name="${id}" type="password" autocomplete="${auto}" placeholder="${placeholder}" required style="padding-right:44px">
      <button type="button" class="btn btn-ghost btn-icon btn-sm pw-toggle" data-pw-toggle aria-label="Mostrar senha">${icon('eye')}</button>
    </div>
  </div>`;

function showError(msg) {
  const err = $('#authError');
  err.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
  err.classList.remove('show');
  void err.offsetWidth;
  err.classList.add('show');
}

function render(info) {
  const first = info.name.split(' ')[0];
  box.innerHTML = `
    <span class="badge violet" style="margin-bottom:12px">${icon('link')}Link pessoal</span>
    <h1>${info.needsPassword ? `Bem-vindo(a), ${esc(first)}!` : `Olá, ${esc(first)}`}</h1>
    <p class="lead">${info.needsPassword
      ? 'Este é o seu primeiro acesso. Crie uma senha para entrar no estoque da loja.'
      : 'Digite sua senha para acessar o estoque da loja.'}</p>
    <form id="authForm" novalidate style="display:flex;flex-direction:column;gap:16px">
      <div class="field">
        <label>E-mail</label>
        <div class="input-icon">${icon('user')}<input class="input" value="${esc(info.email)}" readonly autocomplete="username" style="opacity:.8"></div>
      </div>
      ${info.needsPassword
        ? pwField('password', 'Crie sua senha', 'new-password', 'Mínimo 6 caracteres') + pwField('confirm', 'Confirme a senha', 'new-password', 'Repita a senha')
        : pwField('password', 'Senha', 'current-password', '••••••••')}
      <div class="login-error" id="authError" role="alert"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading="Entrando...">${info.needsPassword ? 'Criar senha e entrar' : 'Entrar'}</button>
    </form>`;
  setTimeout(() => $('#password')?.focus(), 30);

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (info.needsPassword) {
      if ((f.password || '').length < 6) return showError('A senha deve ter pelo menos 6 caracteres.');
      if (f.password !== f.confirm) return showError('As senhas não conferem.');
    } else if (!f.password) return showError('Digite sua senha.');
    try {
      const r = await withLoading($('button[type=submit]', e.target), () => api(`/api/invite/${encodeURIComponent(token)}`, { method: 'POST', body: { password: f.password } }));
      location.href = r.redirect;
    } catch (err) { showError(err.message); }
  });
}

box.addEventListener('click', (e) => {
  const t = e.target.closest('[data-pw-toggle]');
  if (!t) return;
  const input = t.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  t.innerHTML = icon(show ? 'eyeOff' : 'eye');
});

api(`/api/invite/${encodeURIComponent(token)}`)
  .then(render)
  .catch((err) => {
    box.innerHTML = `
      <div class="confirm-ico danger">${icon('alert')}</div>
      <h1>Link indisponível</h1>
      <p class="lead">${esc(err.message)}</p>
      <a class="btn btn-lg btn-block" href="/login">Ir para o login</a>`;
  });
