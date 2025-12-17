const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : __dirname);
const dbPath = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Erro ao conectar BD:', err);
  else console.log('✅ Conectado ao SQLite:', dbPath);
});

// Serializar operações
db.serialize(() => {
  // Tabela de usuários
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    displayName TEXT,
    avatar TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Erro criando users:', err);
    else console.log('✅ Tabela users OK');
  });

  // Garantir colunas `displayName` e `avatar` em instalações existentes
  db.all("PRAGMA table_info('users')", (err, cols) => {
    if (!err && cols) {
      const names = cols.map(c => c.name);
      if (!names.includes('displayName')) {
        db.run("ALTER TABLE users ADD COLUMN displayName TEXT", (e) => { if (e) console.error('Erro ALTER users displayName', e); });
      }
      if (!names.includes('avatar')) {
        db.run("ALTER TABLE users ADD COLUMN avatar TEXT", (e) => { if (e) console.error('Erro ALTER users avatar', e); });
      }
    }
  });

  // Tabela de músicas
  db.run(`CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    duration TEXT,
    thumbnail TEXT,
    videoPreview TEXT,
    category TEXT DEFAULT 'ALL',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Erro criando songs:', err);
    else console.log('✅ Tabela songs OK');
  });

  // Tabela de jogos/scores
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    username TEXT NOT NULL,
    songId INTEGER,
    songTitle TEXT,
    score INTEGER DEFAULT 0,
    room TEXT DEFAULT 'default',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error('Erro criando games:', err);
    else console.log('✅ Tabela games OK');
  });

  // Tabela de ranking
  db.run(`CREATE TABLE IF NOT EXISTS rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL UNIQUE,
    username TEXT NOT NULL,
    totalScore INTEGER DEFAULT 0,
    gamesPlayed INTEGER DEFAULT 0,
    rank INTEGER,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error('Erro criando rankings:', err);
    else console.log('✅ Tabela rankings OK');
  });

  // Tabela de mensagens/chat
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    username TEXT NOT NULL,
    room TEXT DEFAULT 'default',
    message TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error('Erro criando messages:', err);
    else console.log('✅ Tabela messages OK');
  });

  // Tabela de configurações de evento
  db.run(`CREATE TABLE IF NOT EXISTS event_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT 'Just Dance Event',
    maxPlayers INTEGER DEFAULT 100,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Erro criando event_settings:', err);
    else console.log('✅ Tabela event_settings OK');
  });

  // Inserir linha padrão se não existir
  db.get('SELECT COUNT(*) as c FROM event_settings', (err, row) => {
    if (!err && row && row.c === 0) {
      db.run('INSERT INTO event_settings (id, name, maxPlayers) VALUES (1, ?, ?)', ['Just Dance Event', 100]);
    }
  });

  // Tabela de eventos (multi-eventos)
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    maxPlayers INTEGER DEFAULT 0,
    active INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Erro criando events:', err);
    else console.log('✅ Tabela events OK');
  });

  // seed exemplo de evento
  db.get('SELECT COUNT(*) as c FROM events', (err, row) => {
    if (!err && row && row.c === 0) {
      db.run('INSERT INTO events (code, name, maxPlayers, active) VALUES (?, ?, ?, ?)', ['TEST123', 'Evento de Teste', 100, 1]);
    }
  });

  // Tabela de torneios/campeonatos (vinculada a eventos)
  db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'single_elimination',
    status TEXT DEFAULT 'open',
    maxParticipants INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(eventId) REFERENCES events(id)
  )`, (err) => {
    if (err) console.error('Erro criando tournaments:', err);
    else console.log('✅ Tabela tournaments OK');
  });

  // seed torneio para evento TEST123
  db.get('SELECT id FROM events WHERE code = ?', ['TEST123'], (err, ev) => {
    if (!err && ev) {
      db.get('SELECT COUNT(*) as c FROM tournaments WHERE eventId = ?', [ev.id], (e, row) => {
        if (!e && row && row.c === 0) {
          db.run('INSERT INTO tournaments (eventId, name, type, status, maxParticipants) VALUES (?, ?, ?, ?, ?)', 
            [ev.id, 'Campeonato Principal', 'single_elimination', 'open', 16]);
        }
      });
    }
  });

  // Inserir usuários mock (se não existirem)
  const mockUsers = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'staff1', password: 'staff123', role: 'staff' },
    { username: 'staff2', password: 'staff123', role: 'staff' },
    { username: 'user', password: 'user123', role: 'user' },
    { username: 'joao', password: 'joao123', role: 'user' },
    { username: 'maria', password: 'maria123', role: 'user' }
  ];

  mockUsers.forEach(u => {
    db.run('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)',
      [u.username, u.password, u.role],
      (err) => {
        if (err) console.error('Erro inserindo usuário:', err);
      }
    );
  });
});

module.exports = db;
