const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db');
const { generateAccessToken, generateRefreshToken, verifyAccessToken } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let queue = [];
let nextId = 1;
const sessions = {}; // socketId -> { userId, username, role, accessToken }

io.on('connection', socket => {
  socket.emit('queue', queue);
  // enviar lista de músicas atual para novos clientes
  try {
    const songsRaw = fs.readFileSync(path.join(__dirname, 'public', 'songs.json'), 'utf8');
    const songs = JSON.parse(songsRaw);
    socket.emit('songs', songs);
  } catch (err) {
    console.error('Erro lendo songs.json:', err.message);
  }
  // enviar lista de eventos atuais
  db.all('SELECT id, code, name, maxPlayers, active FROM events ORDER BY createdAt DESC', (err, events) => {
    if (err) console.error('Erro lendo events:', err);
    else socket.emit('events', events || []);
  });

  socket.on('login', ({ username, password }, callback) => {
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, user) => {
      if (err) {
        callback({ success: false, error: 'Erro ao autenticar' });
        return;
      }
      if (user) {
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        sessions[socket.id] = { userId: user.id, username: user.username, role: user.role, accessToken };
        callback({ success: true, user: user.username, role: user.role, accessToken, refreshToken });
      } else {
        callback({ success: false, error: 'Credenciais inválidas' });
      }
    });
  });

  socket.on('register', ({ username, password }, callback) => {
    db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, password, 'user'],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            callback({ success: false, error: 'Usuário já existe' });
          } else {
            callback({ success: false, error: 'Erro ao registrar' });
          }
        } else {
          const userId = this.lastID;
          const accessToken = generateAccessToken({ id: userId, username, role: 'user' });
          const refreshToken = generateRefreshToken({ id: userId, username });
          sessions[socket.id] = { userId, username, role: 'user', accessToken };
          callback({ success: true, user: username, role: 'user', accessToken, refreshToken });
        }
      }
    );
  });

  socket.on('join', ({ name, displayName, songId, song, eventCode }, callback) => {
    if (!sessions[socket.id]) {
      callback({ success: false, error: 'Não autenticado' });
      return;
    }
    const session = sessions[socket.id];

    if (!eventCode) {
      callback({ success: false, error: 'Código do evento é obrigatório' });
      return;
    }

    db.get('SELECT id, code, name, maxPlayers, active FROM events WHERE code = ?', [eventCode], (err, ev) => {
      if (err || !ev) {
        callback({ success: false, error: 'Evento não encontrado' });
        return;
      }
      if (ev.active !== 1) {
        callback({ success: false, error: 'Evento não está ativo' });
        return;
      }

      const chosenName = displayName || name || session.username;
      const entry = {
        id: nextId++,
        name: chosenName,
        user: session.username,
        userId: session.userId,
        role: session.role,
        songId,
        song,
        eventId: ev.id,
        eventCode: ev.code,
        timestamp: Date.now()
      };
      queue.push(entry);

      // Registrar no banco de dados (associa ao evento via games table se desejar)
      db.run('INSERT INTO games (userId, username, songId, songTitle, score) VALUES (?, ?, ?, ?, ?)',
        [session.userId, session.username, songId, song, 0],
        (err) => {
          if (err) console.error('Erro registrando game:', err);
        }
      );

      io.emit('queue', queue);
      callback({ success: true, entry });
    });
  });

  // --- Admin / Staff actions: songs and users ---
  socket.on('addSong', (songData, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    const songsPath = path.join(__dirname, 'public', 'songs.json');
    try {
      const raw = fs.readFileSync(songsPath, 'utf8');
      const songs = JSON.parse(raw);
      const newId = (songs.reduce((m, s) => Math.max(m, s.id || 0), 0) || 0) + 1;
      const newSong = Object.assign({ id: newId }, songData);
      songs.push(newSong);
      fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2), 'utf8');
      io.emit('songs', songs);
      callback && callback({ success: true, song: newSong });
    } catch (err) {
      console.error('Erro addSong:', err);
      callback && callback({ success: false, error: 'Erro ao adicionar música' });
    }
  });

  socket.on('removeSong', (id, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    const songsPath = path.join(__dirname, 'public', 'songs.json');
    try {
      const raw = fs.readFileSync(songsPath, 'utf8');
      let songs = JSON.parse(raw);
      songs = songs.filter(s => s.id !== id);
      fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2), 'utf8');
      io.emit('songs', songs);
      callback && callback({ success: true });
    } catch (err) {
      console.error('Erro removeSong:', err);
      callback && callback({ success: false, error: 'Erro ao remover música' });
    }
  });

  socket.on('updateSong', (updated, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    const songsPath = path.join(__dirname, 'public', 'songs.json');
    try {
      const raw = fs.readFileSync(songsPath, 'utf8');
      const songs = JSON.parse(raw);
      const idx = songs.findIndex(s => s.id === updated.id);
      if (idx === -1) return callback && callback({ success: false, error: 'Música não encontrada' });
      songs[idx] = Object.assign(songs[idx], updated);
      fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2), 'utf8');
      io.emit('songs', songs);
      callback && callback({ success: true, song: songs[idx] });
    } catch (err) {
      console.error('Erro updateSong:', err);
      callback && callback({ success: false, error: 'Erro ao atualizar música' });
    }
  });

  // Usuários: listar, criar, atualizar role, remover
  socket.on('listUsers', (_, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    db.all('SELECT id, username, role FROM users', (err, users) => {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao listar usuários' });
      } else {
        callback && callback({ success: true, users });
      }
    });
  });

  socket.on('createUser', ({ username, password, role }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, password, role || 'user'],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            callback && callback({ success: false, error: 'Usuário já existe' });
          } else {
            callback && callback({ success: false, error: 'Erro ao criar usuário' });
          }
        } else {
          callback && callback({ success: true, user: { id: this.lastID, username, role: role || 'user' } });
        }
      }
    );
  });

  socket.on('updateUserRole', ({ username, role }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    db.run('UPDATE users SET role = ? WHERE username = ?', [role, username], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao atualizar role' });
      } else if (this.changes === 0) {
        callback && callback({ success: false, error: 'Usuário não encontrado' });
      } else {
        callback && callback({ success: true, user: { username, role } });
      }
    });
  });

  // Perfil do usuário: obter e atualizar
  socket.on('getProfile', (_, callback) => {
    const session = sessions[socket.id];
    if (!session) return callback && callback({ success: false, error: 'Não autenticado' });
    db.get('SELECT id, username, displayName, avatar FROM users WHERE id = ?', [session.userId], (err, row) => {
      if (err || !row) callback && callback({ success: false, error: 'Perfil não encontrado' });
      else callback && callback({ success: true, profile: row });
    });
  });

  socket.on('updateProfile', ({ displayName, avatar }, callback) => {
    const session = sessions[socket.id];
    if (!session) return callback && callback({ success: false, error: 'Não autenticado' });
    db.run('UPDATE users SET displayName = ?, avatar = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [displayName || null, avatar || null, session.userId], function(err) {
      if (err) callback && callback({ success: false, error: 'Erro ao atualizar perfil' });
      else callback && callback({ success: true });
    });
  });

  // Estatísticas do usuário: posição na fila, músicas favoritas e maior pontuação
  socket.on('getUserStats', (_, callback) => {
    const session = sessions[socket.id];
    if (!session) return callback && callback({ success: false, error: 'Não autenticado' });

    // posição na fila
    const posIdx = queue.findIndex(e => e.userId === session.userId || e.user === session.username);
    const position = posIdx === -1 ? null : posIdx + 1;

    // músicas favoritas (mais jogadas)
    db.all(`SELECT songTitle, COUNT(*) as plays FROM games WHERE userId = ? GROUP BY songTitle ORDER BY plays DESC LIMIT 5`, [session.userId], (err, favRows) => {
      if (err) favRows = [];

      // maior pontuação
      db.get(`SELECT MAX(score) as highScore FROM games WHERE userId = ?`, [session.userId], (err2, highRow) => {
        const highScore = (!err2 && highRow && highRow.highScore != null) ? highRow.highScore : 0;
        callback && callback({ success: true, stats: { position, favoriteSongs: favRows || [], highScore } });
      });
    });
  });

  socket.on('removeUser', (username, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    db.run('DELETE FROM users WHERE username = ?', [username], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao remover usuário' });
      } else if (this.changes === 0) {
        callback && callback({ success: false, error: 'Usuário não existe' });
      } else {
        // remover entradas na fila desse usuário
        queue = queue.filter(e => e.user !== username);
        io.emit('queue', queue);
        callback && callback({ success: true });
      }
    });
  });

  // Eventos: criar/listar/obter por código (admin cria)
  socket.on('createEvent', ({ code, name, maxPlayers, active }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    if (!code || !name) return callback && callback({ success: false, error: 'Código e nome obrigatórios' });
    db.run('INSERT INTO events (code, name, maxPlayers, active) VALUES (?, ?, ?, ?)', [code, name, maxPlayers||0, active?1:0], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao criar evento (talvez código duplicado)' });
      } else {
        db.all('SELECT id, code, name, maxPlayers, active FROM events ORDER BY createdAt DESC', (e, rows) => {
          if (!e) io.emit('events', rows || []);
        });
        callback && callback({ success: true, id: this.lastID });
      }
    });
  });

  socket.on('listEvents', (_, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    db.all('SELECT id, code, name, maxPlayers, active FROM events ORDER BY createdAt DESC', (err, rows) => {
      if (err) callback && callback({ success: false, error: 'Erro ao listar eventos' });
      else callback && callback({ success: true, events: rows || [] });
    });
  });

  socket.on('getEventByCode', ({ code }, callback) => {
    db.get('SELECT id, code, name, maxPlayers, active FROM events WHERE code = ?', [code], (err, row) => {
      if (err || !row) callback && callback({ success: false, error: 'Evento não encontrado' });
      else callback && callback({ success: true, event: row });
    });
  });

  // Atualizar evento (apenas admin) - permite editar nome, código, maxPlayers, active
  socket.on('updateEvent', ({ id, code, name, maxPlayers, active }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    if (!id) return callback && callback({ success: false, error: 'ID do evento obrigatório' });
    const mp = parseInt(maxPlayers || 0, 10) || 0;
    db.run('UPDATE events SET code = ?, name = ?, maxPlayers = ?, active = ? WHERE id = ?', [code, name, mp, active?1:0, id], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao atualizar evento' });
      } else if (this.changes === 0) {
        callback && callback({ success: false, error: 'Evento não encontrado' });
      } else {
        db.all('SELECT id, code, name, maxPlayers, active FROM events ORDER BY createdAt DESC', (e, rows) => {
          if (!e) io.emit('events', rows || []);
        });
        callback && callback({ success: true });
      }
    });
  });

  // Remover evento (apenas admin) - remove torneios vinculados e limpa fila
  socket.on('deleteEvent', ({ id }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    if (!id) return callback && callback({ success: false, error: 'ID do evento obrigatório' });
    db.run('DELETE FROM events WHERE id = ?', [id], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao remover evento' });
        return;
      }
      // remover torneios associados
      db.run('DELETE FROM tournaments WHERE eventId = ?', [id], (e2) => {
        if (e2) console.error('Erro removendo torneios do evento:', e2);
      });
      // limpar fila de entradas do evento
      queue = queue.filter(en => en.eventId !== id);
      io.emit('queue', queue);
      db.all('SELECT id, code, name, maxPlayers, active FROM events ORDER BY createdAt DESC', (e, rows) => {
        if (!e) io.emit('events', rows || []);
      });
      callback && callback({ success: true });
    });
  });

  // Torneios: criar, listar por evento
  socket.on('createTournament', ({ eventId, name, type, maxParticipants }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    if (!eventId || !name) return callback && callback({ success: false, error: 'EventId e name obrigatórios' });
    db.run('INSERT INTO tournaments (eventId, name, type, status, maxParticipants) VALUES (?, ?, ?, ?, ?)', 
      [eventId, name, type || 'single_elimination', 'open', maxParticipants || 0], function(err) {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao criar torneio' });
      } else {
        db.all('SELECT id, eventId, name, type, status, maxParticipants FROM tournaments WHERE eventId = ?', [eventId], (e, rows) => {
          if (!e) io.emit('tournaments', { eventId, tournaments: rows || [] });
        });
        callback && callback({ success: true, id: this.lastID });
      }
    });
  });

  socket.on('listTournamentsByEvent', ({ eventId }, callback) => {
    if (!eventId) return callback && callback({ success: false, error: 'EventId obrigatório' });
    db.all('SELECT id, eventId, name, type, status, maxParticipants FROM tournaments WHERE eventId = ? ORDER BY createdAt DESC', 
      [eventId], (err, rows) => {
      if (err) callback && callback({ success: false, error: 'Erro ao listar torneios' });
      else callback && callback({ success: true, tournaments: rows || [] });
    });
  });

  // Salvar configurações do evento (apenas admin)
  socket.on('saveEventSettings', ({ name, maxPlayers }, callback) => {
    const session = sessions[socket.id];
    if (!session || session.role !== 'admin') {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    const maxP = parseInt(maxPlayers || 0, 10) || 0;
    db.run(
      `INSERT OR REPLACE INTO event_settings (id, name, maxPlayers, updatedAt) VALUES (1, ?, ?, CURRENT_TIMESTAMP)`,
      [name || 'Event', maxP],
      function(err) {
        if (err) {
          console.error('Erro salvando event settings:', err);
          callback && callback({ success: false, error: 'Erro ao salvar' });
        } else {
          // notificar clientes
          db.get('SELECT name, maxPlayers FROM event_settings WHERE id = 1', (err2, row) => {
            if (!err2 && row) io.emit('eventSettings', row);
            callback && callback({ success: true, settings: row });
          });
        }
      }
    );
  });

  socket.on('getEventSettings', (_, callback) => {
    db.get('SELECT name, maxPlayers FROM event_settings WHERE id = 1', (err, row) => {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao obter settings' });
      } else {
        callback && callback({ success: true, settings: row });
      }
    });
  });

  socket.on('leave', ({ id }, callback) => {
    const entry = queue.find(e => e.id === id);
    const session = sessions[socket.id];
    if (!entry) {
      callback({ success: false, error: 'Entrada não encontrada' });
      return;
    }
    // Permitir remoção pelo dono da entrada ou por staff/admin
    if (session && (session.user === entry.user || session.role === 'admin' || session.role === 'staff')) {
      queue = queue.filter(e => e.id !== id);
      io.emit('queue', queue);
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Não autorizado' });
    }
  });

  // Permite que admin limpe toda a fila
  socket.on('clearQueue', (_, callback) => {
    const session = sessions[socket.id];
    if (session && session.role === 'admin') {
      queue = [];
      io.emit('queue', queue);
      callback && callback({ success: true });
    } else {
      callback && callback({ success: false, error: 'Não autorizado' });
    }
  });

  // Staff/Admin chamar próximo jogador (remover do início da fila)
  socket.on('nextPlayer', (_, callback) => {
    const session = sessions[socket.id];
    if (!session || (session.role !== 'staff' && session.role !== 'admin')) {
      callback && callback({ success: false, error: 'Não autorizado' });
      return;
    }
    if (queue.length === 0) {
      callback && callback({ success: false, error: 'Fila vazia' });
      return;
    }
    const called = queue.shift();
    io.emit('queue', queue);
    io.emit('playerCalled', { player: called, remainingQueue: queue });
    callback && callback({ success: true, player: called });
  });

  socket.on('logout', () => {
    delete sessions[socket.id];
    socket.emit('logged_out');
  });

  socket.on('disconnect', () => {
    delete sessions[socket.id];
  });
});

// --- SCORING & LEADERBOARD ---

// Função auxiliar para atualizar ranking
function updateRankings(callback) {
  db.all(`
    SELECT userId, username, SUM(score) as totalScore, COUNT(*) as gamesPlayed
    FROM games
    GROUP BY userId
    ORDER BY totalScore DESC
  `, (err, rows) => {
    if (err) {
      console.error('Erro ao calcular ranking:', err);
      if (callback) callback([]);
      return;
    }
    
    // Atualizar/inserir em rankings
    rows.forEach((row, idx) => {
      db.run(
        `INSERT OR REPLACE INTO rankings (userId, username, totalScore, gamesPlayed, rank)
         VALUES (?, ?, ?, ?, ?)`,
        [row.userId, row.username, row.totalScore, row.gamesPlayed, idx + 1],
        (err) => {
          if (err) console.error('Erro ao atualizar ranking:', err);
        }
      );
    });
    
    if (callback) callback(rows);
  });
}

// Evento: registrar score de uma música
io.on('connection', socket => {
  socket.on('submitScore', ({ score, songId, songTitle, userId, username }, callback) => {
    const session = sessions[socket.id];
    if (!session) {
      callback && callback({ success: false, error: 'Não autenticado' });
      return;
    }

    // Permitir que staff/admin registre score para outro usuário passando userId ou username
    let targetUserId = null;
    let targetUsername = username || null;

    const proceedUpdate = (resolvedUserId, resolvedUsername) => {
      if (!resolvedUserId) {
        callback && callback({ success: false, error: 'Usuário alvo não encontrado' });
        return;
      }

      // Atualiza o último registro de game daquele usuário e música
      db.run(
        `UPDATE games SET score = ? WHERE id = (
            SELECT id FROM games WHERE userId = ? AND songId = ? ORDER BY id DESC LIMIT 1
          )`,
        [score, resolvedUserId, songId],
        (err) => {
          if (err) {
            callback && callback({ success: false, error: 'Erro ao registrar score' });
          } else {
            updateRankings((rankings) => {
              io.emit('leaderboard', rankings.slice(0, 10));
              io.emit('scoreUpdate', { username: resolvedUsername || resolvedUserId, score, songTitle });
              callback && callback({ success: true });
            });
          }
        }
      );
    };

    if (userId && (session.role === 'staff' || session.role === 'admin')) {
      proceedUpdate(userId, username);
    } else if (username && (session.role === 'staff' || session.role === 'admin')) {
      // resolver username para userId
      db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
        if (err || !row) return callback && callback({ success: false, error: 'Usuário alvo não encontrado' });
        proceedUpdate(row.id, username);
      });
    } else {
      // usuário comum atualiza seu próprio score
      proceedUpdate(session.userId, session.username);
    }
  });

  // Obter leaderboard atual
  socket.on('getLeaderboard', (_, callback) => {
    db.all(`
      SELECT rank, username, totalScore, gamesPlayed
      FROM rankings
      ORDER BY rank ASC
      LIMIT 10
    `, (err, rows) => {
      if (err) {
        callback && callback({ success: false, error: 'Erro ao obter leaderboard' });
      } else {
        callback && callback({ success: true, leaderboard: rows || [] });
      }
    });
  });

});

// --- HTTP Routes ---

// Refresh Token
app.post('/api/refresh-token', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token é obrigatório' });
  }
  
  const { verifyRefreshToken } = require('./auth');
  const decoded = verifyRefreshToken(refreshToken);
  
  if (!decoded) {
    return res.status(401).json({ error: 'Refresh token inválido' });
  }
  
  db.get('SELECT id, username, role FROM users WHERE id = ?', [decoded.id], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    
    const { generateAccessToken } = require('./auth');
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
