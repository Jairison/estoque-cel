// Configuração do Firebase do projeto da loja (imperio-cell-estoque).
// Console: ⚙ Configurações do projeto → Seus apps → App da Web → "firebaseConfig".
// Esses valores NÃO são secretos: a proteção dos dados é feita pelas regras (firestore.rules).
export const firebaseConfig = {
  apiKey: 'AIzaSyD0YE8VCaRxFTehWHGOG4u1NeLfEjDk950',
  authDomain: 'imperio-cell-estoque.firebaseapp.com',
  projectId: 'imperio-cell-estoque',
  storageBucket: 'imperio-cell-estoque.firebasestorage.app',
  messagingSenderId: '833845106569',
  appId: '1:833845106569:web:8bf7d7bf6c6a480cd7b358',
};

// true apenas para testes locais com o Firebase Emulator (npm run emuladores)
export const useEmulator = false;
