# Império Cell — Estoque de iPhones

Sistema de estoque com duas áreas, **Administrador** e **Colaborador**, no mesmo sistema.
As telas ficam publicadas no **GitHub Pages**. Login e dados ficam no **Firebase** (Authentication + Cloud Firestore), compartilhados entre todos os aparelhos.

**Endereço:** https://jairison.github.io/estoque-cel/

## Configurar o Firebase (uma vez só, ~5 minutos)

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) com sua conta Google e clique em **Criar projeto** (ex.: `imperio-cell-estoque`). O Google Analytics pode ficar desativado.
2. **Authentication** → **Vamos começar** → **Método de login** → ative **E-mail/senha** → Salvar.
3. **Firestore Database** → **Criar banco de dados** → escolha a região **`southamerica-east1` (São Paulo)** → modo **produção**.
4. Ainda no Firestore, abra a aba **Regras**, apague o conteúdo, cole todo o arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.
5. **Authentication → Configurações → Domínios autorizados** → **Adicionar domínio** → `jairison.github.io`.
6. Em **⚙ Configurações do projeto → Seus apps**, clique no ícone **`</>`** (Web), dê um nome e registre. Copie os valores de `firebaseConfig` para o arquivo [`js/firebase-config.js`](js/firebase-config.js) e envie para o GitHub.
7. Abra o endereço do sistema e faça o **primeiro acesso**: o primeiro cadastro vira o administrador principal.

Os valores do `firebaseConfig` **não são secretos**. Quem protege os dados são as regras do Firestore.

## Perfis

**Colaborador**
- Vê o estoque da loja por modelo, capacidade (GB), cor e condição, com atualização em tempo real.
- Monta pedidos com vários aparelhos e dá saída, ou dá saída por IMEI.
- **Não vê** preços, custos, dashboard, usuários nem auditoria. Isso é bloqueado pelas regras do Firebase, não só escondido na tela.

**Administrador** tem acesso a tudo:
- Dashboard com faturamento, lucro, valor do estoque, gráficos e alertas de estoque baixo.
- Aparelhos: busca (inclusive por IMEI), filtros, edição, status, ações em lote e exportação CSV.
- Nova entrada por IMEI (com validação) ou por quantidade.
- Movimentações com estorno, usuários, auditoria, configurações e backup.

## Acesso e cadastro
- **Primeiro acesso:** o primeiro cadastro no sistema vira o administrador.
- **Colaborador cria a própria conta:** na tela de login, em **Criar conta**. Com o **código da loja** (visível para o admin em *Usuários*), o acesso é liberado na hora. Sem o código, a conta aguarda aprovação.
- **Admin cadastra a pessoa:** em *Usuários → Novo usuário*. Sem senha, a pessoa recebe um **e-mail para criar a própria senha**. O botão **Acesso** gera o link do sistema para enviar pelo WhatsApp.
- **Esqueci minha senha:** na tela de login, o Firebase envia o e-mail de redefinição.
- Admin e colaborador podem ficar conectados ao mesmo tempo no mesmo navegador, cada um na própria conta.

## Testar no computador

```bash
npm start            # abre as telas em http://localhost:5500 (usa o Firebase configurado)
npm run emuladores   # opcional: Firebase local para testes (precisa de Java), com useEmulator = true
```

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Login, criar conta, primeiro acesso, esqueci a senha |
| `admin.html` / `js/admin.js` | Painel do administrador |
| `colaborador.html` / `js/colaborador.js` | Tela do colaborador |
| `js/db.js` | Todas as operações no Firebase (login, estoque, saídas, usuários…) |
| `js/firebase-config.js` | Dados do projeto Firebase da loja |
| `firestore.rules` | Regras de segurança (quem pode ler e alterar o quê) |
