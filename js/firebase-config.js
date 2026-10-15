// Configuração do Firebase do projeto da loja.
// No console do Firebase: ⚙ Configurações do projeto → Seus apps → App da Web → "firebaseConfig".
// Esses valores NÃO são secretos: a proteção dos dados é feita pelas regras (firestore.rules).
export const firebaseConfig = {
  apiKey: 'COLE_AQUI',
  authDomain: 'COLE_AQUI.firebaseapp.com',
  projectId: 'COLE_AQUI',
  storageBucket: 'COLE_AQUI.firebasestorage.app',
  messagingSenderId: 'COLE_AQUI',
  appId: 'COLE_AQUI',
};

// true apenas para testes locais com o Firebase Emulator (npm run emuladores)
export const useEmulator = false;
