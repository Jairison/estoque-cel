# Império Cell — Estoque de iPhones

Sistema de estoque com dois perfis (Administrador e Colaborador) no mesmo sistema.

## Como rodar

Requer Node.js 18 ou superior. Não tem dependências, então não precisa de `npm install`.

```bash
npm start        # inicia em http://localhost:3000
npm run demo     # inicia e carrega dados de exemplo (só se o estoque estiver vazio)
```

## Acesso por e-mail e senha

1. **Primeiro acesso**: ao abrir o sistema pela primeira vez, aparece a tela **"Configure o administrador"**. Ali você cadastra o nome, o e-mail e a senha da conta principal.
2. **Cadastrar colaboradores**: há dois caminhos.
   - O administrador cadastra direto em **Usuários → Novo usuário**, informando e-mail, senha e perfil.
   - A pessoa clica em **"Criar conta"** na tela de login e cadastra o próprio e-mail e senha. A conta fica **pendente** até o administrador validar em **Usuários → Solicitações de acesso**, onde pode aprovar (como colaborador ou administrador) ou recusar.
3. **Login**: sempre com e-mail e senha.

### Cadastro do próprio colaborador (código da loja)

Cada pessoa tem o **seu próprio cadastro**, e todos ficam ligados ao mesmo estoque.
- Na tela de login, o colaborador clica em **Criar conta** e informa nome, e-mail e senha.
- Com o **código da loja**, que aparece para o admin em **Usuários**, o acesso é liberado na hora. Sem o código, o cadastro fica aguardando aprovação do admin.
- **Novo código** troca o código. Quem já tem conta não é afetado.

### Admin e colaborador conectados ao mesmo tempo

As sessões do admin e do colaborador são separadas. Os dois podem estar conectados no mesmo navegador sem que um derrube ou assuma a conta do outro, e a tela de login sempre abre para entrar com outra conta. Em computadores compartilhados, o admin deve clicar em **Sair** ao terminar.

### Link de acesso individual (colaborador em outro computador ou celular)

Em **Usuários**, o botão **Link** gera um endereço pessoal para cada colaborador, que pode ser copiado ou enviado pelo WhatsApp.
- No cadastro de um novo usuário, deixe a senha em branco. A pessoa abre o link no aparelho dela e **cria a própria senha** no primeiro acesso.
- Nos acessos seguintes, o mesmo link pede só a senha. O login normal com e-mail e senha também funciona.
- **Gerar novo link** invalida o anterior. **Revogar** desativa o link.

Onde o link funciona:
- **Mesma rede (Wi-Fi da loja)**: funciona direto, com o endereço local do computador onde o sistema roda (ex.: `http://10.0.0.163:3001`). Esse computador precisa estar ligado e com o sistema aberto.
- **Pela internet (outro local)**: o sistema precisa estar publicado num servidor ou num túnel. Informe o endereço em **Configurações → Acesso externo**, e os links passam a usar esse endereço.

`npm run demo` cria contas de exemplo: `admin@imperiocell.com` / `admin123` e `colaborador@imperiocell.com` / `colab123`.

Se a porta 3000 estiver ocupada por outro programa, o sistema usa a próxima livre (3001, 3002…). **Use sempre o endereço que aparece no terminal.** Não abra os arquivos `.html` direto pelo explorador de arquivos.

Para escolher a porta: `PORT=8080 npm start` (no PowerShell: `$env:PORT=8080; npm start`).

## Perfis

**Colaborador**: vê quantos iPhones existem por modelo, capacidade (GB) e cor, e registra saídas (por modelo ou por IMEI). Não vê preços nem custos.

**Administrador** tem acesso a tudo:
- Dashboard com faturamento, lucro, valor do estoque, gráficos e alertas de estoque baixo
- Aparelhos: busca, filtros, edição, status (disponível/reservado/manutenção), ações em lote e exportação CSV
- Nova entrada: em lote por IMEI (com validação) ou por quantidade
- Movimentações: histórico completo com filtros por período, detalhes e estorno
- Usuários: criar, editar, ativar e desativar, redefinir senha
- Auditoria: registro de todas as ações
- Configurações: nome da loja, limite de estoque baixo, catálogo de modelos, capacidades e cores, backup

## Dados

Tudo fica em `data/db.json`. Todo dia é salvo um backup automático em `data/backups/`, que guarda os últimos 30 dias.
