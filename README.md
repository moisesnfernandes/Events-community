# Just Dance - Sistema de Fila Virtual

Frontend moderno com login + sistema de fila em tempo real para seleção de músicas.

## Recursos

- 🔐 **Autenticação**: Login e Registro de usuários
- 🎵 **Menu de Seleção**: Escolha a música antes de entrar na fila
- 👥 **Fila em Tempo Real**: Socket.io para atualizações ao vivo
- 📱 **Responsivo**: Design mobile-friendly com gradientes modernos
- ⭐ **UI Bonita**: Animações suaves e visual atrativo

## Setup

```bash
npm install
npm start
```

Abra http://localhost:3000

**Credenciais de teste:**
- Usuário: `user` | Senha: `user123`
- Usuário: `admin` | Senha: `admin123`

## Estrutura

- `server.js` - Express + Socket.io (autenticação, fila)
- `public/index.html` - Login + Queue UI
- `public/app.js` - Cliente Socket.io
- `public/styles.css` - Design responsivo
- `public/songs.json` - Lista de músicas
