const API_BASE_URL = (window.API_BASE_URL || (document.querySelector('meta[name="api-base-url"]')?.content || '')).trim();
const socket = API_BASE_URL ? io(API_BASE_URL, { transports: ['polling'] }) : io({ transports: ['polling'] });

let currentUser = null;
let currentRole = null;
let currentSong = null;
let myQueuePosition = null;
let allSongs = [];
let lastQueue = [];
let lastCalledPlayer = null; // jogador que foi chamado e está/esteve tocando
let currentEventCode = null;
let currentEventId = null;
let currentEventName = null;
let currentTournaments = [];
let currentProfile = { displayName: null, avatar: '🙂' };
let currentViewMode = 'vertical';
let lastFilteredSongs = [];

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function goToMenu() {
  showScreen('menuScreen');
  document.getElementById('menuUserName').textContent = `Olá, ${currentUser}!`;
  // Mostrar botões de staff/admin conforme role
  const btnStaff = document.getElementById('btnStaffPanel');
  const btnAdmin = document.getElementById('btnAdminPanel');
  if (btnStaff) btnStaff.style.display = (currentRole === 'staff' || currentRole === 'admin') ? 'block' : 'none';
  if (btnAdmin) btnAdmin.style.display = (currentRole === 'admin') ? 'block' : 'none';
  loadVersionOrder();
  updateMenuStatsLocal();
  updateMenuPosition();
  updateMenuWaitEstimate();
  renderMenuEventInfo();
  autoLoadEventCode();
}

// Quick join: abre seleção de música e foca botão entrar
function quickJoin(){
  goToMusicSelect();
  // opcional: destacar botão entrar
  const joinBtn = document.querySelector('.btn-join-queue');
  if(joinBtn){ joinBtn.classList.add('pulse'); setTimeout(()=>joinBtn.classList.remove('pulse'),900); }
}

// Atualiza estado visual do bottom nav (marcar ativo)
function setActiveBottomNav(target){
  const nav = document.getElementById('bottomNav');
  if(!nav) return;
  Array.from(nav.querySelectorAll('button')).forEach(b=> b.classList.remove('active'));
  if(target && typeof target === 'string'){
    const btn = Array.from(nav.querySelectorAll('button')).find(b=> b.getAttribute('onclick') && b.getAttribute('onclick').includes(target));
    if(btn) btn.classList.add('active');
  }
}

// hook existing navigation functions to mark bottom nav
const _goToMenu = goToMenu;
goToMenu = function(){ _goToMenu(); setActiveBottomNav('goToMenu'); };
const _goToMusicSelect = goToMusicSelect;
goToMusicSelect = function(){ _goToMusicSelect(); setActiveBottomNav('goToMusicSelect'); };
const _goToQueue = goToQueue;
goToQueue = function(){ _goToQueue(); setActiveBottomNav('goToQueue'); };
const _openLeaderboard = openLeaderboard;
openLeaderboard = function(){ _openLeaderboard(); setActiveBottomNav('openLeaderboard'); };

// hook profile and tournaments for bottom nav highlighting
const _openProfile = openProfile;
openProfile = function(){ _openProfile(); setActiveBottomNav('openProfile'); };
const _openTournaments = openTournaments;
openTournaments = function(){ _openTournaments(); setActiveBottomNav('openTournaments'); };

function openEventModal(){
  const m = document.getElementById('eventModal');
  if (m) m.style.display = 'flex';
}
function closeEventModal(){
  const m = document.getElementById('eventModal');
  if (m) m.style.display = 'none';
}
function submitEventCodeModal(){
  const input = document.getElementById('eventCodeModalInput');
  const code = (input?.value || '').trim().toUpperCase();
  if (!code) { notifyError('Digite o código do evento'); return; }
  const fallbackInput = document.getElementById('eventCodeInput');
  if (fallbackInput) fallbackInput.value = code;
  setEventByCode();
}

function getEventCodeKey(){
  return `lastEventCode_${currentUser || 'anon'}`;
}
function saveEventCode(code){
  try { localStorage.setItem(getEventCodeKey(), code || ''); } catch (e) {}
}
function loadEventCode(){
  try { return localStorage.getItem(getEventCodeKey()) || ''; } catch (e) { return ''; }
}
function autoLoadEventCode(){
  if (currentEventCode) return;
  const saved = loadEventCode();
  if (saved) {
    const input = document.getElementById('eventCodeInput');
    if (input) input.value = saved;
    setEventByCode();
  }
}

function renderMenuEventInfo(){
  const el = document.getElementById('menuEventInfo');
  if (!el) return;
  if (currentEventCode && currentEventName) el.textContent = `Evento: ${currentEventName} (${currentEventCode})`;
  else if (currentEventCode) el.textContent = `Evento: ${currentEventCode}`;
  else el.textContent = 'Evento: —';
}

function goToMusicSelect() {
  showScreen('musicSelectScreen');
  loadSongs();
}

function updateJoinAs() {
  const joinAs = document.getElementById('joinAs');
  if (joinAs) joinAs.textContent = currentUser || '—';
}

function goToQueue() {
  showScreen('queueScreen');
  document.getElementById('queueUserInfo').textContent = `Usuário: ${currentUser}`;
}

// ===== LOGIN / REGISTER =====
function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const errorDiv = document.getElementById('loginError');

  if (!username || !password) {
    errorDiv.textContent = '❌ Preencha todos os campos!';
    return;
  }

  socket.emit('login', { username, password }, (response) => {
    if (response.success) {
      currentUser = response.username || response.user || null;
      currentRole = response.role || response.role || null;
      // mostrar menu inferior agora que está logado
      const bottom = document.getElementById('bottomNav'); if (bottom) { bottom.style.display = 'flex'; setTimeout(()=>bottom.classList.add('show'),50); }

      // carregar perfil
      socket.emit('getProfile', {}, (pRes) => {
        if (pRes && pRes.success && pRes.profile) {
          currentProfile.displayName = pRes.profile.displayName || null;
          currentProfile.avatar = pRes.profile.avatar || currentProfile.avatar;
          renderMenuAvatar();
        }
      });
      // carregar estatísticas do usuário (posição, favoritas, maior pontuação)
      socket.emit('getUserStats', {}, (sRes) => {
        if (sRes && sRes.success && sRes.stats) {
          const st = sRes.stats;
          const posEl = document.getElementById('menuPos');
          const highEl = document.getElementById('menuHigh');
          const favEl = document.getElementById('menuFav');
          if (posEl) posEl.textContent = 'Posição na fila: ' + (st.position ? st.position : '—');
          if (highEl) highEl.textContent = 'Maior pontuação: ' + (st.highScore != null ? st.highScore : '—');
          if (favEl) favEl.textContent = 'Favoritas: ' + ((st.favoriteSongs && st.favoriteSongs.length) ? st.favoriteSongs.map(f=> f.songTitle).join(', ') : '—');
        }
      });
      errorDiv.textContent = '';
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
      if (currentRole === 'admin') {
        goToAdmin();
      } else if (currentRole === 'staff') {
        goToStaff();
      } else {
        goToMenu();
      }
      updateJoinAs();
    } else {
      errorDiv.textContent = '❌ ' + response.message;
    }
  });
}

function renderMenuAvatar(){
  const avatarEl = document.getElementById('menuAvatar');
  const nameEl = document.getElementById('menuUserName');
  if (avatarEl) avatarEl.textContent = currentProfile.avatar || '🙂';
  if (nameEl) nameEl.textContent = currentProfile.displayName ? `Olá, ${currentProfile.displayName}` : `Olá, ${currentUser || 'Jogador'}`;
}

function openProfile(){
  // abrir tela de perfil completa
  goToProfile();
}

function openProfileModalForEdit(){
  // reusar modal para edição rápida a partir da tela de perfil
  const modal = document.getElementById('profileModal');
  const preview = document.getElementById('profileAvatarPreview');
  const displayInput = document.getElementById('profileDisplayName');
  const avatarsEl = document.getElementById('avatarOptions');
  if (!modal) return;
  displayInput.value = currentProfile.displayName || '';
  if (preview) preview.textContent = currentProfile.avatar || '🙂';
  const avatars = ['🙂','😎','🕺','💃','🎧','👑','🔥','⭐','🎵','🎮'];
  avatarsEl.innerHTML = '';
  avatars.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn btn-avatar';
    b.style.padding = '8px';
    b.style.fontSize = '20px';
    b.textContent = a;
    b.addEventListener('click', ()=>{ currentProfile.avatar = a; if(preview) preview.textContent = a; renderMenuAvatar(); });
    avatarsEl.appendChild(b);
  });
  modal.style.display = 'flex';
}

function goToProfile(){
  showScreen('profileScreen');
  // preencher dados (usar dados em memória, e atualizar via servidor)
  const avatarEl = document.getElementById('profileScreenAvatar');
  const nameEl = document.getElementById('profileScreenName');
  const userEl = document.getElementById('profileScreenUser');
  const posEl = document.getElementById('profilePos');
  const highEl = document.getElementById('profileHigh');
  const favsEl = document.getElementById('profileFavs');
  if (avatarEl) avatarEl.textContent = currentProfile.avatar || '🙂';
  if (nameEl) nameEl.textContent = currentProfile.displayName || currentUser || '';
  if (userEl) userEl.textContent = '@' + (currentUser || '');

  // buscar stats do servidor para garantir dados atualizados
  socket.emit('getUserStats', {}, (sRes) => {
    if (sRes && sRes.success && sRes.stats) {
      const st = sRes.stats;
      if (posEl) posEl.textContent = st.position ? st.position : '—';
      if (highEl) highEl.textContent = (st.highScore != null ? st.highScore : '—');
      if (favsEl) favsEl.textContent = (st.favoriteSongs && st.favoriteSongs.length) ? st.favoriteSongs.map(f=> `${f.songTitle} (${f.plays})`).join(', ') : '—';
    }
  });
}

function closeProfile(){
  const modal = document.getElementById('profileModal');
  if (modal) modal.style.display = 'none';
}

function saveProfile(){
  const displayInput = document.getElementById('profileDisplayName');
  if (displayInput) currentProfile.displayName = displayInput.value.trim() || null;
  socket.emit('updateProfile', { displayName: currentProfile.displayName, avatar: currentProfile.avatar }, (res) => {
    if (res && res.success) {
      notifySuccess('Perfil salvo');
      renderMenuAvatar();
      closeProfile();
    } else {
      notifyError('Falha ao salvar perfil');
    }
  });
}

function handleRegister() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const errorDiv = document.getElementById('registerError');

  if (!username || !password) {
    errorDiv.textContent = '❌ Preencha todos os campos!';
    return;
  }

  if (password.length < 3) {
    errorDiv.textContent = '❌ Senha deve ter no mínimo 3 caracteres!';
    return;
  }

  socket.emit('register', { username, password }, (response) => {
    if (response.success) {
      errorDiv.textContent = '';
      document.getElementById('newUsername').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('loginError').textContent = `✅ Conta criada! Faça login com ${username}`;
      // se o servidor já autenticou ao registrar, atualiza estado local
      if (response.user || response.username) {
        currentUser = response.username || response.user;
        currentRole = response.role || null;
        updateJoinAs();
      }
    } else {
      errorDiv.textContent = '❌ ' + response.message;
    }
  });
}

function handleLogout() {
  socket.emit('logout');
  currentUser = null;
  currentRole = null;
  currentSong = null;
  myQueuePosition = null;
  showScreen('loginScreen');
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  updateJoinAs();
  const bottom = document.getElementById('bottomNav'); if (bottom) { bottom.classList.remove('show'); bottom.style.display = 'none'; }
}

// Inicialização UI: esconder bottom nav até login
document.addEventListener('DOMContentLoaded', () => {
  const bottom = document.getElementById('bottomNav'); if (bottom) bottom.style.display = 'none';
});

// ===== MUSIC SELECTION =====
function loadSongs() {
  const url = API_BASE_URL ? `${API_BASE_URL}/songs.json` : '/songs.json';
  fetch(url)
    .then(res => res.json())
    .then(songs => {
      allSongs = songs;
      populateArtistFilter();
      applyMusicFilters();
    })
    .catch(err => console.error('Erro ao carregar músicas:', err));
}

// ===== MUSIC FILTERS =====
function populateArtistFilter() {
  const artistSelect = document.getElementById('artistFilter');
  if (!artistSelect) return;
  
  const artists = [...new Set(allSongs.map(s => s.artist))].sort();
  const currentValue = artistSelect.value;
  
  artistSelect.innerHTML = '<option value="">Todos os Artistas</option>';
  artists.forEach(artist => {
    if (artist) {
      const option = document.createElement('option');
      option.value = artist;
      option.textContent = artist;
      artistSelect.appendChild(option);
    }
  });
  
  if (currentValue) artistSelect.value = currentValue;
}

function applyMusicFilters() {
  const search = document.getElementById('musicSearchInput')?.value.toLowerCase() || '';
  const version = document.getElementById('versionFilter')?.value || '';
  const type = document.getElementById('typeFilter')?.value || '';
  const artist = document.getElementById('artistFilter')?.value || '';
  
  let filtered = allSongs.filter(song => {
    const matchSearch = !search || 
      song.title.toLowerCase().includes(search) || 
      song.artist.toLowerCase().includes(search);
    
    const matchVersion = !version || song.version === version;
    const matchType = !type || song.type === type;
    const matchArtist = !artist || song.artist === artist;
    
    return matchSearch && matchVersion && matchType && matchArtist;
  });
  
  lastFilteredSongs = filtered;
  renderSongsGrid(filtered);
  const listEl = document.getElementById('musicGrid');
  if (listEl) listEl.style.display = '';
  const carouselEl = document.getElementById('musicCarousel');
  if (carouselEl) carouselEl.style.display = 'none';
  updateFilterCount(filtered.length);
}

function resetMusicFilters() {
  document.getElementById('musicSearchInput').value = '';
  document.getElementById('versionFilter').value = '';
  document.getElementById('typeFilter').value = '';
  document.getElementById('artistFilter').value = '';
  applyMusicFilters();
}

function updateFilterCount(count) {
  const countEl = document.getElementById('filterCount');
  if (countEl) {
    countEl.textContent = `${count} ${count === 1 ? 'música' : 'músicas'}`;
  }
}

function renderCarousel(songs) {
  const carousel = document.getElementById('musicCarousel');
  const infoEl = document.getElementById('carouselInfo');
  if (!carousel) return;
  
  carousel.innerHTML = '';
  
  if (!songs || songs.length === 0) {
    if (infoEl) infoEl.textContent = 'Nenhuma música encontrada';
    return;
  }
  
  songs.forEach(song => {
    const card = createHorizontalMusicCard(song);
    carousel.appendChild(card);
  });
  
  if (infoEl) infoEl.textContent = `${songs.length} ${songs.length === 1 ? 'música' : 'músicas'} encontrada(s)`;
}

function createHorizontalMusicCard(song) {
  const card = document.createElement('div');
  card.className = 'music-card-horizontal';
  card.dataset.id = song.id;
  if (currentSong && currentSong.id === song.id) {
    card.classList.add('selected');
  }
  
  const typeEmoji = {
    'solo': '🎭',
    'dupla': '👫',
    'trio': '👬',
    'quarteto': '👨‍👩‍👧‍👦'
  };
  
  const versionLabel = {
    'JD2024': '2024',
    'JD2023': '2023',
    'JD2022': '2022'
  };
  
  card.innerHTML = `
    <img src="${song.thumbnail}" alt="${song.title}" class="card-image">
    <div class="card-content">
      <div>
        <div class="card-song-name">${song.title}</div>
        <div class="card-artist-name">${song.artist}</div>
      </div>
      <div class="card-meta">
        <span class="card-meta-item">${typeEmoji[song.type] || '🎵'} ${song.type}</span>
        <span class="card-meta-item">📀 ${versionLabel[song.version] || song.version}</span>
      </div>
    </div>
  `;
  
  card.addEventListener('click', () => selectSong(song));
  return card;
}

function renderMusicList(songs) {
  const listContainer = document.getElementById('musicList');
  const infoEl = document.getElementById('carouselInfo');
  if (!listContainer) return;
  listContainer.innerHTML = '';
  if (!songs || songs.length === 0) {
    if (infoEl) infoEl.textContent = 'Nenhuma música encontrada';
    return;
  }
  songs.forEach(song => {
    const isSelected = currentSong && currentSong.id === song.id;
    const item = document.createElement('div');
    item.className = 'music-list-item' + (isSelected ? ' selected' : '');
    item.dataset.id = song.id;
    item.innerHTML = `
      <img src="${song.thumbnail}" alt="${song.title}">
      <div class="music-list-item-info">
        <div class="music-list-item-title">${song.title}</div>
        <div class="music-list-item-artist">${song.artist}</div>
      </div>
    `;
    item.addEventListener('click', () => selectSong(song));
    listContainer.appendChild(item);
  });
  if (infoEl) infoEl.textContent = `${songs.length} ${songs.length === 1 ? 'música' : 'músicas'} encontrada(s)`;
}

// view mode alternation removida; sempre vertical por versão

function renderSongsGrid(songs) {
  const grid = document.getElementById('musicGrid');
  const infoEl = document.getElementById('carouselInfo');
  if (!grid) return;
  grid.innerHTML = '';
  if (!songs || songs.length === 0) {
    if (infoEl) infoEl.textContent = 'Nenhuma música encontrada';
    return;
  }
  songs.forEach(song => {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.dataset.id = song.id;
    if (currentSong && currentSong.id === song.id) card.classList.add('selected');
    const typeEmoji = { solo: '🎭', dupla: '👫', trio: '👬', quarteto: '👨‍👩‍👧‍👦' };
    const versionLabel = { JD2024: '2024', JD2023: '2023', JD2022: '2022' };
    card.innerHTML = `
      <div class="song-score" aria-label="Pontuação"></div>
      <button class="favorite-btn" aria-label="Favoritar">♡</button>
      <img class="song-thumb" src="${song.thumbnail}" alt="${song.title}">
      <div class="song-body">
        <div class="song-title">${song.title}</div>
        <div class="song-artist">${song.artist}</div>
        <div class="song-meta">
          <span class="meta">${typeEmoji[song.type] || '🎵'} ${song.type}</span>
          <span class="meta">📀 ${versionLabel[song.version] || song.version}</span>
        </div>
      </div>
    `;
    const favBtn = card.querySelector('.favorite-btn');
    if (favBtn) {
      const fav = isFavorite(song.id);
      favBtn.textContent = fav ? '❤️' : '♡';
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(song.id);
        favBtn.textContent = isFavorite(song.id) ? '❤️' : '♡';
      });
    }
    card.addEventListener('click', () => selectSong(song));
    grid.appendChild(card);
  });
  if (infoEl) infoEl.textContent = `${songs.length} ${songs.length === 1 ? 'música' : 'músicas'} encontrada(s)`;
}

function songIdFromTitle(title) {
  if (!title) return null;
  const found = allSongs.find(s => (s.title || '').toLowerCase() === title.toLowerCase());
  return found ? found.id : null;
}

function updateSongCardScore(songId, score) {
  if (!songId && currentSong) songId = currentSong.id;
  const card = document.querySelector(`.song-card[data-id="${songId}"]`);
  if (!card) return;
  let badge = card.querySelector('.song-score');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'song-score';
    card.prepend(badge);
  }
  const s = parseInt(score, 10) || 0;
  let stars = '';
  let cls = 'score-basic';
  let label = '';
  if (s >= 13333) { stars = '⭐⭐⭐⭐⭐'; cls = 'score-perfect'; label = 'All Perfect'; }
  else if (s >= 12400) { stars = '⭐⭐⭐⭐⭐'; cls = 'score-megastar'; label = 'Megastar'; }
  else if (s >= 11000) { stars = '⭐⭐⭐⭐⭐'; cls = 'score-superstar'; label = 'Superstar'; }
  else if (s >= 10000) { stars = '⭐⭐⭐⭐⭐'; cls = 'score-basic'; }
  else if (s >= 8000) { stars = '⭐⭐⭐⭐'; cls = 'score-basic'; }
  else if (s >= 6000) { stars = '⭐⭐⭐'; cls = 'score-basic'; }
  else if (s >= 4000) { stars = '⭐⭐'; cls = 'score-basic'; }
  else if (s >= 2000) { stars = '⭐'; cls = 'score-basic'; }
  else { stars = ''; cls = 'score-basic'; }
  badge.innerHTML = label ? `${stars} <span class="score-label">${label}</span>` : stars || `⭐`;
  badge.setAttribute('aria-label', label || `${s} pontos`);
  badge.classList.remove('score-basic','score-superstar','score-megastar','score-perfect');
  badge.classList.add(cls);
  badge.classList.add('score-animated');
  setTimeout(() => badge.classList.remove('score-animated'), 800);
}

function getFavoritesKey() {
  return `favorites_${currentUser || 'anon'}`;
}

function getFavorites() {
  try {
    const raw = localStorage.getItem(getFavoritesKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveFavorites(favs) {
  try { localStorage.setItem(getFavoritesKey(), JSON.stringify(favs || [])); } catch (e) {}
}

function isFavorite(songId) {
  const favs = getFavorites();
  return favs.includes(songId);
}

function toggleFavorite(songId) {
  let favs = getFavorites();
  if (favs.includes(songId)) {
    favs = favs.filter(id => id !== songId);
  } else {
    favs.push(songId);
  }
  saveFavorites(favs);
  updateMenuStatsLocal();
}

function selectSong(song) {
  currentSong = song;
  document.getElementById('previewTitle').textContent = song.title;
  document.getElementById('previewArtist').textContent = song.artist;
  document.getElementById('previewDuration').textContent = `⏱️ ${song.duration || '-'}`;
  const versionLabel = {
    'JD2024': '📀 Just Dance 2024',
    'JD2023': '📀 Just Dance 2023',
    'JD2022': '📀 Just Dance 2022'
  };
  document.getElementById('previewVersion').textContent = versionLabel[song.version] || `📀 ${song.version}`;
  const typeLabel = {
    'solo': '👥 Solo',
    'dupla': '👫 Dupla',
    'trio': '👬 Trio',
    'quarteto': '👨‍👩‍👧‍👦 Quarteto'
  };
  document.getElementById('previewType').textContent = typeLabel[song.type] || `👥 ${song.type}`;
  const iframe = document.getElementById('videoPreview');
  const videoEl = document.getElementById('videoPreviewVideo');
  const src = song.videoPreview || '';
  const isFile = /\.mp4($|\?)/i.test(src) || /\.webm($|\?)/i.test(src) || src.includes('/uploads/videos/');
  if (isFile) {
    if (videoEl) { videoEl.src = src; videoEl.style.display = 'block'; }
    if (iframe) { iframe.src = ''; iframe.style.display = 'none'; }
  } else {
    if (iframe) { iframe.src = src; iframe.style.display = 'block'; }
    if (videoEl) { videoEl.removeAttribute('src'); videoEl.style.display = 'none'; }
  }
  document.querySelectorAll('.music-card-horizontal').forEach(card => card.classList.remove('selected'));
  document.querySelectorAll('.music-list-item').forEach(item => item.classList.remove('selected'));
  document.querySelectorAll('.song-card').forEach(item => item.classList.remove('selected'));
  const selectedCard = document.querySelector(`.music-card-horizontal[data-id="${song.id}"]`);
  const selectedItem = document.querySelector(`.music-list-item[data-id="${song.id}"]`);
  const selectedGrid = document.querySelector(`.song-card[data-id="${song.id}"]`);
  if (selectedCard) selectedCard.classList.add('selected');
  if (selectedItem) selectedItem.classList.add('selected');
  if (selectedGrid) selectedGrid.classList.add('selected');
  updateJoinAs();
}

function updateCounters() {
  const newCount = allSongs.filter(s => s.category === 'NEW').length;
  const allCount = allSongs.length;
  document.getElementById('newCounter').textContent = `0/${newCount}`;
  document.getElementById('allCounter').textContent = `0/${allCount}`;
}

// ===== QUEUE =====
function joinQueue() {
  const joinError = document.getElementById('joinError');

  if (!currentUser) {
    joinError.textContent = '❌ Você precisa estar logado!';
    return;
  }

  if (!currentSong) {
    joinError.textContent = '❌ Selecione uma música!';
    return;
  }

  if (!currentEventCode) {
    joinError.textContent = '❌ Você precisa entrar em um evento com código!';
    return;
  }

  socket.emit('join', {
    username: currentUser,
    displayName: currentUser,
    song: currentSong.title,
    role: currentRole,
    eventCode: currentEventCode
  }, (response) => {
    if (response.success) {
      joinError.textContent = '';
      recordJoinStart();
      goToQueue();
    } else {
      joinError.textContent = '❌ ' + response.message;
    }
  });
}

socket.on('queue', (queue) => {
  lastQueue = queue;
  renderQueue(queue);
  renderStaffQueue();
  renderAdminQueue();
  updateStaffNextPlayer();
  updateMenuPosition();
  updateMenuWaitEstimate();
});

// Recebe notificação quando um jogador é chamado
socket.on('playerCalled', ({ player, remainingQueue }) => {
  console.log('Jogador chamado:', player);
  // armazenar o jogador chamado (para permitir submeter pontuação depois)
  lastCalledPlayer = player;
  notifyPlayerCalled(player);
  updateStaffNextPlayer();
  updateMenuPosition();
  updateMenuWaitEstimate();
  const pname = player && (player.user || player.username || player.name);
  if (pname && pname === currentUser) {
    const start = consumeJoinStart();
    if (start) pushWaitTime(Date.now() - start);
    updateMenuStatsLocal();
  }
});

// Recebe atualizações do catálogo de músicas
socket.on('songs', (songs) => {
  window.currentSongs = songs || [];
  renderAdminSongs();
  // atualizar grids também se estivermos na tela de seleção
  if (document.getElementById('newMusicGrid')) {
    allSongs = window.currentSongs;
    renderMusicGrids();
  }
});

socket.on('events', (events) => {
  // Atualiza lista de eventos para o admin em tempo real
  try {
    const el = document.getElementById('adminEventsList');
    if (el) {
      el.innerHTML = '';
      (events || []).forEach(ev => {
        const d = document.createElement('div');
        d.style.padding = '8px';
        d.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
        const info = document.createElement('div');
        info.innerHTML = `<strong>${ev.name}</strong> — <code>${ev.code}</code> — Máx:${ev.maxPlayers||0} — ${ev.active? 'Ativo':'Inativo'}`;
        d.appendChild(info);

        const btns = document.createElement('div');
        btns.style.marginTop = '6px';
        btns.style.display = 'flex';
        btns.style.gap = '8px';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-primary';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => editEvent(ev));

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-secondary';
        toggleBtn.textContent = ev.active? 'Desativar' : 'Ativar';
        toggleBtn.addEventListener('click', () => toggleEventActive(ev));

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.textContent = 'Excluir';
        delBtn.addEventListener('click', () => deleteEvent(ev.id));

        btns.appendChild(editBtn);
        btns.appendChild(toggleBtn);
        btns.appendChild(delBtn);
        d.appendChild(btns);

        el.appendChild(d);
      });
      const ec = document.getElementById('adminEventCount'); if (ec) ec.textContent = String((events || []).length);
    }
  } catch (e) { console.error('events handler', e); }
});
  function selectSongLegacy(song) {
    currentSong = song;
  
    // Atualizar preview
    document.getElementById('previewTitle').textContent = song.title;
    document.getElementById('previewArtist').textContent = song.artist;
    document.getElementById('previewDuration').textContent = `⏱️ ${song.duration || '-'}`;
  
    const versionLabel = {
      'JD2024': '📀 Just Dance 2024',
      'JD2023': '📀 Just Dance 2023',
      'JD2022': '📀 Just Dance 2022'
    };
    document.getElementById('previewVersion').textContent = versionLabel[song.version] || `📀 ${song.version}`;
  
    const typeLabel = {
      'solo': '👥 Solo',
      'dupla': '👫 Dupla',
      'trio': '👬 Trio',
      'quarteto': '👨‍👩‍👧‍👦 Quarteto'
    };
    document.getElementById('previewType').textContent = typeLabel[song.type] || `👥 ${song.type}`;
  
    document.getElementById('videoPreview').src = song.videoPreview;
  
    // Atualizar cards selecionado
    document.querySelectorAll('.music-card-horizontal').forEach(card => card.classList.remove('selected'));
    document.querySelectorAll('.music-list-item').forEach(item => item.classList.remove('selected'));
  
    const selectedCard = document.querySelector(`.music-card-horizontal[data-id="${song.id}"]`);
    const selectedItem = document.querySelector(`.music-list-item[data-id="${song.id}"]`);
    if (selectedCard) selectedCard.classList.add('selected');
    if (selectedItem) selectedItem.classList.add('selected');
  
    // Atualizar o label "Entrar como"
    updateJoinAs();
  
    // Renderizar lista vertical
    renderMusicList();
  }

  function renderMusicListLegacy() {
    const listContainer = document.getElementById('musicList');
    if (!listContainer) return;
  
    listContainer.innerHTML = '';
  
    if (!allSongs || allSongs.length === 0) {
      listContainer.innerHTML = '<p style="color: #888; text-align: center;">Nenhuma música</p>';
      return;
    }
  
    allSongs.forEach(song => {
      const isSelected = currentSong && currentSong.id === song.id;
    
      const item = document.createElement('div');
      item.className = 'music-list-item' + (isSelected ? ' selected' : '');
      item.dataset.id = song.id;
    
      item.innerHTML = `
        <img src="${song.thumbnail}" alt="${song.title}">
        <div class="music-list-item-info">
          <div class="music-list-item-title">${song.title}</div>
          <div class="music-list-item-artist">${song.artist}</div>
        </div>
      `;
    
      item.addEventListener('click', () => selectSong(song));
      listContainer.appendChild(item);
    });
  }

function setEventByCode(){
  const code = (document.getElementById('eventCodeInput')||{}).value.trim();
  if(!code){ notifyError('Digite o código do evento'); return; }
  socket.emit('getEventByCode', { code: code.toUpperCase() }, (res)=>{
    if(!res || !res.success){ notifyError('Evento não encontrado ou inativo'); return; }
    currentEventCode = res.event.code;
    currentEventId = res.event.id;
    currentEventName = res.event.name || null;
    notifySuccess('Entrou no evento: '+res.event.name);
    document.getElementById('eventCodeInput').value = currentEventCode;
    saveEventCode(currentEventCode);
    renderMenuEventInfo();
    closeEventModal();
    // carregar torneios do evento
    socket.emit('listTournamentsByEvent', { eventId: currentEventId }, (tRes)=>{
      if(tRes && tRes.success) currentTournaments = tRes.tournaments || [];
      renderTournaments();
    });
  });
}

function renderTournaments(){
  const el = document.getElementById('tournamentsList');
  if(!el) return;
  el.innerHTML = '';
  if(!currentTournaments || currentTournaments.length === 0){
    el.innerHTML = '<div style="color:#888">Nenhum campeonato neste evento</div>';
    return;
  }
  currentTournaments.forEach(t=>{
    const d = document.createElement('div');
    d.style.padding = '8px';
    d.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    d.innerHTML = `<strong>${t.name}</strong> — ${t.type} — ${t.status} — <button onclick="selectTournament(${t.id}, '${t.name}')">Selecionar</button>`;
    el.appendChild(d);
  });
}

function createEvent(){
  const code = (document.getElementById('adminEventCode')||{}).value.trim();
  const name = (document.getElementById('adminEventName')||{}).value.trim();
  const maxP = parseInt((document.getElementById('adminEventMaxPlayers')||{}).value||'0',10)||0;
  if(!code || !name){ notifyError('Código e nome são obrigatórios'); return; }
  socket.emit('createEvent', { code, name, maxPlayers: maxP, active: 1 }, (res)=>{
    if(res && res.success){ notifySuccess('Evento criado'); loadEvents(); } else { notifyError('Falha ao criar evento'); }
  });
}

function loadEvents(){
  socket.emit('listEvents', {}, (res)=>{
    if(res && res.success){ socket.emit('events', res.events); /* fallback emit to clients */ }
    // server will emit 'events' to all on creation; if not, request will populate via server callback
    // Render lista de eventos com controles de admin
    if(res && res.success){
      const el = document.getElementById('adminEventsList');
      if(el){
        el.innerHTML = '';
        res.events.forEach(ev => {
          const d = document.createElement('div');
          d.style.padding = '8px';
          d.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
          const info = document.createElement('div');
          info.innerHTML = `<strong>${ev.name}</strong> — <code>${ev.code}</code> — Máx:${ev.maxPlayers||0} — ${ev.active? 'Ativo':'Inativo'}`;
          d.appendChild(info);

          const btns = document.createElement('div');
          btns.style.marginTop = '6px';
          btns.style.display = 'flex';
          btns.style.gap = '8px';

          const editBtn = document.createElement('button');
          editBtn.className = 'btn btn-primary';
          editBtn.textContent = 'Editar';
          editBtn.addEventListener('click', () => editEvent(ev));

          const toggleBtn = document.createElement('button');
          toggleBtn.className = 'btn btn-secondary';
          toggleBtn.textContent = ev.active? 'Desativar' : 'Ativar';
          toggleBtn.addEventListener('click', () => toggleEventActive(ev));

          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-danger';
          delBtn.textContent = 'Excluir';
          delBtn.addEventListener('click', () => deleteEvent(ev.id));

          btns.appendChild(editBtn);
          btns.appendChild(toggleBtn);
          btns.appendChild(delBtn);
          d.appendChild(btns);

          el.appendChild(d);
        });
      }
    }
  });

function editEvent(ev){
  const name = prompt('Nome do evento:', ev.name || '') || ev.name || '';
  const code = prompt('Código do evento (único):', ev.code || '') || ev.code || '';
  const maxPlayersStr = prompt('Máx. jogadores (0 = sem limite):', String(ev.maxPlayers||0));
  const maxPlayers = parseInt(maxPlayersStr||'0',10) || 0;
  const active = confirm('Evento ativo? OK = Sim, Cancel = Não');
  socket.emit('updateEvent', { id: ev.id, code, name, maxPlayers, active: active?1:0 }, (res) => {
    if(res && res.success){ notifySuccess('Evento atualizado'); loadEvents(); }
    else notifyError('Falha ao atualizar evento: '+(res && res.error || 'erro'));
  });
}

function toggleEventActive(ev){
  const newActive = ev.active? 0 : 1;
  socket.emit('updateEvent', { id: ev.id, code: ev.code, name: ev.name, maxPlayers: ev.maxPlayers||0, active: newActive }, (res) => {
    if(res && res.success){ notifySuccess('Status do evento atualizado'); loadEvents(); }
    else notifyError('Falha ao atualizar status');
  });
}

function deleteEvent(id){
  if(!confirm('Confirma excluir este evento? Esta ação removerá torneios vinculados e limpará a fila.')) return;
  socket.emit('deleteEvent', { id }, (res) => {
    if(res && res.success){ notifySuccess('Evento removido'); loadEvents(); }
    else notifyError('Falha ao remover evento');
  });
}
}

function createTournament(){
  const name = (document.getElementById('adminTournamentName')||{}).value.trim();
  const type = (document.getElementById('adminTournamentType')||{}).value || 'single_elimination';
  const maxP = parseInt((document.getElementById('adminTournamentMaxParticipants')||{}).value||'0',10)||0;
  if(!name){ notifyError('Nome do campeonato é obrigatório'); return; }
  if(!currentEventId){ notifyError('Nenhum evento selecionado'); return; }
  socket.emit('createTournament', { eventId: currentEventId, name, type, maxParticipants: maxP }, (res)=>{
    if(res && res.success){ notifySuccess('Campeonato criado'); loadTournamentsByEvent(); } else { notifyError('Falha ao criar campeonato'); }
  });
}

function loadTournamentsByEvent(){
  if(!currentEventId) return;
  socket.emit('listTournamentsByEvent', { eventId: currentEventId }, (res)=>{
    if(res && res.success){ currentTournaments = res.tournaments || []; renderAdminTournaments(); }
  });
}

function renderAdminTournaments(){
  const el = document.getElementById('adminTournamentsList');
  if(!el) return;
  el.innerHTML = '';
  if(!currentTournaments || currentTournaments.length === 0){
    el.innerHTML = '<div style="color:#888">Nenhum campeonato</div>';
    const tc = document.getElementById('adminTournamentCount'); if (tc) tc.textContent = '0';
    return;
  }
  const tc = document.getElementById('adminTournamentCount'); if (tc) tc.textContent = String(currentTournaments.length);
  currentTournaments.forEach(t=>{
    const d = document.createElement('div');
    d.style.padding = '8px';
    d.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    d.innerHTML = `<strong>${t.name}</strong> — ${t.type} — ${t.status}`;
    el.appendChild(d);
  });
}

let currentSelectedTournament = null;
function selectTournament(tId, tName){
  currentSelectedTournament = { id: tId, name: tName };
  notifySuccess('Campeonato selecionado: '+tName);
  goToMusicSelect();
}

socket.on('eventSettings', (settings) => {
  try {
    if (settings && typeof settings === 'object') {
      const nameEl = document.getElementById('eventNameInput');
      const maxEl = document.getElementById('eventMaxPlayersInput');
      if (nameEl) nameEl.value = settings.name || '';
      if (maxEl) maxEl.value = settings.maxPlayers || '';
    }
  } catch (e) { console.error('eventSettings handler', e); }
});

// Recebe atualizações do leaderboard em tempo real
socket.on('leaderboard', (leaderboard) => {
  renderLeaderboard(leaderboard);
});

// Notificação de pontuação registrada
socket.on('scoreUpdate', ({ username, score, songTitle }) => {
  notifyScoreUpdate(username, score);
  const id = songIdFromTitle(songTitle);
  if (id) updateSongCardScore(id, score);
  if (username === currentUser) {
    const sId = songIdFromTitle(songTitle);
    if (sId) incrementPlayCount(sId);
    updateMenuStatsLocal();
  }
});

function getPlaysKey() {
  return `plays_${currentUser || 'anon'}`;
}

function getWaitKey() {
  return `waitTimes_${currentUser || 'anon'}`;
}

function incrementPlayCount(songId) {
  try {
    const raw = localStorage.getItem(getPlaysKey());
    const map = raw ? JSON.parse(raw) : {};
    map[songId] = (map[songId] || 0) + 1;
    localStorage.setItem(getPlaysKey(), JSON.stringify(map));
  } catch (e) {}
}

function recordJoinStart() {
  try { localStorage.setItem(`queueJoinStart_${currentUser || 'anon'}`, String(Date.now())); } catch (e) {}
}

function consumeJoinStart() {
  try {
    const k = `queueJoinStart_${currentUser || 'anon'}`;
    const raw = localStorage.getItem(k);
    localStorage.removeItem(k);
    return raw ? parseInt(raw, 10) : null;
  } catch (e) { return null; }
}

function pushWaitTime(ms) {
  try {
    const raw = localStorage.getItem(getWaitKey());
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(ms);
    localStorage.setItem(getWaitKey(), JSON.stringify(arr));
  } catch (e) {}
}

function formatAvgWait(msArr) {
  if (!msArr || !msArr.length) return '—';
  const avg = Math.round(msArr.reduce((a,b)=>a+b,0) / msArr.length);
  const mins = Math.floor(avg / 60000);
  const secs = Math.round((avg % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function mostPlayedTitle() {
  try {
    const raw = localStorage.getItem(getPlaysKey());
    const map = raw ? JSON.parse(raw) : {};
    const entries = Object.entries(map);
    if (!entries.length) return '—';
    const [topId] = entries.sort((a,b)=>b[1]-a[1])[0];
    const song = allSongs.find(s=> String(s.id) === String(topId));
    return song ? song.title : '—';
  } catch (e) { return '—'; }
}

function favoritesListTitles() {
  const favs = getFavorites();
  if (!favs.length) return '—';
  const titles = favs.map(id => {
    const s = allSongs.find(x => String(x.id) === String(id));
    return s ? s.title : `#${id}`;
  }).filter(Boolean);
  return titles.length ? titles.join(', ') : '—';
}

function updateMenuStatsLocal() {
  const topEl = document.getElementById('menuTopSong');
  const waitEl = document.getElementById('menuWait');
  const favEl = document.getElementById('menuFav');
  if (topEl) topEl.textContent = mostPlayedTitle();
  // tempo de espera agora é estimado com base na fila atual
  if (waitEl) waitEl.textContent = '—';
  if (favEl) favEl.textContent = favoritesListTitles();
}
function updateMenuPosition() {
  const el = document.getElementById('menuPos');
  if (!el) return;
  if (!lastQueue || lastQueue.length === 0) {
    el.textContent = 'Fila vazia';
    return;
  }
  const idx = lastQueue.findIndex(e => (e.user === currentUser) || (e.username === currentUser) || (e.name === currentUser));
  if (idx !== -1) el.textContent = `Posição na fila: #${idx + 1}`;
  else el.textContent = 'Você não está na fila';
}
function parseDurationSeconds(d) {
  if (!d && d !== 0) return null;
  if (typeof d === 'number') return d;
  const s = String(d).trim();
  if (!s) return null;
  // Formats: mm:ss, m:ss, ss, "3m 12s", "3min", "180"
  const mmss = /^(\d{1,2}):(\d{2})$/;
  const mss = mmss.exec(s);
  if (mss) return (parseInt(mss[1],10)*60) + parseInt(mss[2],10);
  const minsMatch = /(\d+)\s*m(in)?/i.exec(s);
  const secsMatch = /(\d+)\s*s(ec)?/i.exec(s);
  if (minsMatch || secsMatch) {
    const mins = minsMatch ? parseInt(minsMatch[1],10) : 0;
    const secs = secsMatch ? parseInt(secsMatch[1],10) : 0;
    return (mins*60)+secs;
  }
  const num = parseInt(s,10);
  return isNaN(num) ? null : num;
}
function getSongDurationByTitle(title) {
  if (!title) return null;
  const list = (window.currentSongs && window.currentSongs.length) ? window.currentSongs : allSongs || [];
  const s = (list || []).find(x => (x.title === title));
  return s ? parseDurationSeconds(s.duration) : null;
}
function formatMinutesRange(minSec, maxSec) {
  const fmt = (sec) => {
    const m = Math.floor(sec/60);
    const s = Math.round(sec%60);
    if (m <= 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
  };
  if (minSec == null && maxSec == null) return '—';
  if (minSec != null && maxSec != null) {
    if (Math.abs(maxSec - minSec) < 1) return fmt(minSec);
    return `${fmt(minSec)}–${fmt(maxSec)}`;
  }
  const v = (minSec != null) ? minSec : maxSec;
  return fmt(v);
}
function updateMenuWaitEstimate() {
  const waitEl = document.getElementById('menuWait');
  if (!waitEl) return;
  if (!lastQueue || lastQueue.length === 0) { waitEl.textContent = '—'; return; }
  const idx = lastQueue.findIndex(e => (e.user === currentUser) || (e.username === currentUser) || (e.name === currentUser));
  if (idx === -1) { waitEl.textContent = '—'; return; }
  if (idx === 0) { waitEl.textContent = '0m'; return; }
  // Sum durations + overhead (2 to 3 minutes) for each player before me
  let minTotal = 0;
  let maxTotal = 0;
  for (let i = 0; i < idx; i++) {
    const entry = lastQueue[i];
    const dur = getSongDurationByTitle(entry.song) || 0;
    minTotal += dur + 120; // +2 min
    maxTotal += dur + 180; // +3 min
  }
  waitEl.textContent = formatMinutesRange(minTotal, maxTotal);
}
// Recebe novas mensagens do chat
// chat removido

function adminAddSong() {
  const title = document.getElementById('adminSongTitle').value.trim();
  const artist = document.getElementById('adminSongArtist').value.trim();
  const duration = document.getElementById('adminSongDuration').value.trim();
  const thumbnail = document.getElementById('adminSongThumb').value.trim();
  const preview = document.getElementById('adminSongPreview').value.trim();
  const version = document.getElementById('adminSongVersion').value;
  const type = document.getElementById('adminSongType').value;
  const category = document.getElementById('adminSongCategory').value;
  const msg = document.getElementById('adminSongMsg');
  if (!title || !artist) { msg.textContent = 'Título e artista são obrigatórios'; return; }
  socket.emit('addSong', { title, artist, duration, thumbnail, videoPreview: preview, category, version, type }, (res) => {
    if (res && res.success) {
      msg.textContent = '✅ Música adicionada';
      document.getElementById('adminSongTitle').value = '';
      document.getElementById('adminSongArtist').value = '';
      document.getElementById('adminSongDuration').value = '';
      document.getElementById('adminSongThumb').value = '';
      document.getElementById('adminSongPreview').value = '';
      document.getElementById('adminSongVersion').value = 'JD2024';
      document.getElementById('adminSongType').value = 'solo';
      updateAdminAddPreviews();
    } else {
      msg.textContent = '❌ ' + (res && res.error ? res.error : 'Erro');
    }
  });
}
function adminAddSongFromCatalog() {
  const title = document.getElementById('adminSongTitleCat').value.trim();
  const artist = document.getElementById('adminSongArtistCat').value.trim();
  const duration = document.getElementById('adminSongDurationCat').value.trim();
  const thumbnail = document.getElementById('adminSongThumbCat').value.trim();
  const preview = document.getElementById('adminSongPreviewCat').value.trim();
  const version = document.getElementById('adminSongVersionCat').value || versionOrder[0] || '';
  const type = document.getElementById('adminSongTypeCat').value;
  const category = document.getElementById('adminSongCategoryCat').value;
  const msg = document.getElementById('adminSongMsgCat');
  if (!title || !artist) { msg.textContent = 'Título e artista são obrigatórios'; return; }
  socket.emit('addSong', { title, artist, duration, thumbnail, videoPreview: preview, category, version, type }, (res) => {
    if (res && res.success) {
      msg.textContent = '✅ Música adicionada';
      document.getElementById('adminSongTitleCat').value = '';
      document.getElementById('adminSongArtistCat').value = '';
      document.getElementById('adminSongDurationCat').value = '';
      document.getElementById('adminSongThumbCat').value = '';
      document.getElementById('adminSongPreviewCat').value = '';
      document.getElementById('adminSongVersionCat').value = '';
      document.getElementById('adminSongTypeCat').value = 'solo';
      updateAdminAddPreviewsCat();
    } else {
      msg.textContent = '❌ ' + (res && res.error ? res.error : 'Erro');
    }
  });
}
function isVideoFileSrc(src) {
  const s = String(src || '');
  return /\.mp4($|\?)/i.test(s) || /\.webm($|\?)/i.test(s) || s.includes('/uploads/videos/');
}
function updateAdminAddPreviews() {
  const img = document.getElementById('adminAddThumbPreview');
  const vid = document.getElementById('adminAddVideoPreview');
  const thumb = document.getElementById('adminSongThumb')?.value.trim() || '';
  const prev = document.getElementById('adminSongPreview')?.value.trim() || '';
  if (img) { if (thumb) { img.src = thumb; img.style.display = 'block'; } else { img.style.display = 'none'; } }
  if (vid) {
    if (prev && isVideoFileSrc(prev)) { vid.src = prev; vid.style.display = 'block'; }
    else { vid.removeAttribute('src'); vid.style.display = 'none'; }
  }
}
function updateAdminAddPreviewsCat() {
  const img = document.getElementById('adminAddThumbPreviewCat');
  const vid = document.getElementById('adminAddVideoPreviewCat');
  const thumb = document.getElementById('adminSongThumbCat')?.value.trim() || '';
  const prev = document.getElementById('adminSongPreviewCat')?.value.trim() || '';
  if (img) { if (thumb) { img.src = thumb; img.style.display = 'block'; } else { img.style.display = 'none'; } }
  if (vid) {
    if (prev && isVideoFileSrc(prev)) { vid.src = prev; vid.style.display = 'block'; }
    else { vid.removeAttribute('src'); vid.style.display = 'none'; }
  }
}
function resetAdminAddForm() {
  document.getElementById('adminSongTitle').value = '';
  document.getElementById('adminSongArtist').value = '';
  document.getElementById('adminSongDuration').value = '';
  document.getElementById('adminSongThumb').value = '';
  document.getElementById('adminSongPreview').value = '';
  document.getElementById('adminSongVersion').value = versionOrder[0] || 'JD2024';
  document.getElementById('adminSongType').value = 'solo';
  document.getElementById('adminSongCategory').value = 'ALL';
  updateAdminAddPreviews();
}

function renderAdminSongs() {
  const list = document.getElementById('adminSongsList');
  if (!list) return;
  const all = window.currentSongs || [];
  const search = (document.getElementById('adminSongSearch')?.value || '').toLowerCase();
  const fVer = document.getElementById('adminSongFilterVersion')?.value || '';
  const fType = document.getElementById('adminSongFilterType')?.value || '';
  let songs = all.filter(s => {
    const okSearch = !search || (String(s.title||'').toLowerCase().includes(search) || String(s.artist||'').toLowerCase().includes(search));
    const okVer = !fVer || s.version === fVer;
    const okType = !fType || s.type === fType;
    return okSearch && okVer && okType;
  });
  list.innerHTML = '';
  const filtCountEl = document.getElementById('adminSongFilterCount');
  if (filtCountEl) filtCountEl.textContent = String(songs.length);
  const totalEl = document.getElementById('adminSongCount');
  if (totalEl) totalEl.textContent = String(all.length);
  if (songs.length === 0) { list.innerHTML = '<li>Nenhuma música</li>'; return; }
  songs.forEach(s => {
    const li = document.createElement('li');
    li.className = 'admin-song-item';
    const verOptions = (versionOrder || []).map(v => `<option value="${v}"${s.version===v?' selected':''}>${versionLabel(v)}</option>`).join('');
    li.innerHTML = `
      <div class="admin-song-left">
        <img src="${s.thumbnail || ''}" class="admin-song-thumb">
        <div class="admin-song-fields">
          <input class="admin-input" id="song_title_${s.id}" value="${s.title || ''}" placeholder="Título">
          <input class="admin-input" id="song_artist_${s.id}" value="${s.artist || ''}" placeholder="Artista">
          <input class="admin-input" id="song_duration_${s.id}" value="${s.duration || ''}" placeholder="Duração">
          <input class="admin-input" id="song_thumb_${s.id}" value="${s.thumbnail || ''}" placeholder="URL Thumbnail">
          <div style="display:flex;gap:8px;margin:6px 0;"><input type="file" id="song_thumb_file_${s.id}" accept=".png,.jpg,.jpeg,.webp"><button class="btn btn-secondary btn-small" onclick="adminUploadCoverForSong(${s.id})">Enviar Capa</button></div>
          <input class="admin-input" id="song_preview_${s.id}" value="${s.videoPreview || ''}" placeholder="URL Preview">
          <div style="display:flex;gap:8px;margin:6px 0;"><input type="file" id="song_video_file_${s.id}" accept=".mp4,.webm"><button class="btn btn-secondary btn-small" onclick="adminUploadVideoForSong(${s.id})">Enviar Vídeo</button></div>
          <select class="admin-select" id="song_version_${s.id}">${verOptions}</select>
          <select class="admin-select" id="song_type_${s.id}">
            <option value="solo"${s.type==='solo'?' selected':''}>Solo</option>
            <option value="dupla"${s.type==='dupla'?' selected':''}>Dupla</option>
            <option value="trio"${s.type==='trio'?' selected':''}>Trio</option>
            <option value="quarteto"${s.type==='quarteto'?' selected':''}>Quarteto</option>
          </select>
          <select class="admin-select" id="song_category_${s.id}">
            <option value="ALL"${s.category==='ALL'?' selected':''}>ALL</option>
            <option value="NEW"${s.category==='NEW'?' selected':''}>NEW</option>
          </select>
        </div>
      </div>
      <div class="admin-song-actions">
        <button class="btn btn-primary" onclick="adminUpdateSong(${s.id})">Salvar</button>
        <button class="queue-item-remove" onclick="adminRemoveSong(${s.id})">Remover</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function adminRemoveSong(id) {
  if (!confirm('Remover música id ' + id + '?')) return;
  socket.emit('removeSong', id, (res) => {
    if (!res || !res.success) alert('Erro ao remover: ' + (res && res.error));
  });
}

function adminUpdateSong(id) {
  const payload = {
    id,
    title: document.getElementById('song_title_' + id).value.trim(),
    artist: document.getElementById('song_artist_' + id).value.trim(),
    duration: document.getElementById('song_duration_' + id).value.trim(),
    thumbnail: document.getElementById('song_thumb_' + id).value.trim(),
    videoPreview: document.getElementById('song_preview_' + id).value.trim(),
    version: document.getElementById('song_version_' + id).value,
    type: document.getElementById('song_type_' + id).value,
    category: document.getElementById('song_category_' + id).value
  };
  socket.emit('updateSong', payload, (res) => {
    if (res && res.success) {
      notifySuccess('Música atualizada');
      window.currentSongs = window.currentSongs.map(s => s.id === id ? res.song : s);
      renderAdminSongs();
      populateArtistFilter();
      applyMusicFilters();
    } else {
      notifyError('Falha ao atualizar música');
    }
  });
}

let versionOrder = ['JD2024', 'JD2023', 'JD2022'];
function loadVersionOrder() {
  try {
    const saved = localStorage.getItem('versionOrder');
    if (saved) versionOrder = saved.split(',').map(s => s.trim()).filter(Boolean);
    const input = document.getElementById('versionOrderInput');
    if (input) input.value = versionOrder.join(',');
  } catch {}
}

function saveVersionOrder() {
  const input = document.getElementById('versionOrderInput');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  versionOrder = raw.split(',').map(s => s.trim()).filter(Boolean);
  try { localStorage.setItem('versionOrder', versionOrder.join(',')); } catch {}
  applyMusicFilters();
  notifySuccess('Ordem de versões atualizada');
  populateAdminVersionControls();
}

function versionLabel(v) {
  const m = /^JD(\\d{4})$/.exec(String(v));
  return m ? `Just Dance ${m[1]}` : String(v);
}

function populateAdminVersionControls() {
  // Adicionar Música
  const addSel = document.getElementById('adminSongVersion');
  if (addSel) {
    addSel.innerHTML = (versionOrder || []).map(v => `<option value=\"${v}\">${versionLabel(v)}</option>`).join('');
    if (versionOrder.length) addSel.value = versionOrder[0];
  }
  // Filtro
  const filterSel = document.getElementById('adminSongFilterVersion');
  if (filterSel) {
    filterSel.innerHTML = `<option value=\"\">Versão</option>` + (versionOrder || []).map(v => `<option value=\"${v}\">${v}</option>`).join('');
  }
}

function addVersion() {
  const input = document.getElementById('adminNewVersion');
  if (!input) return;
  const v = input.value.trim();
  if (!v) return notifyWarning('Informe uma versão, ex: JD2025');
  if (versionOrder.includes(v)) {
    notifyInfo('Versão já existe na ordem');
    return;
  }
  versionOrder.push(v);
  try { localStorage.setItem('versionOrder', versionOrder.join(',')); } catch {}
  const vo = document.getElementById('versionOrderInput'); if (vo) vo.value = versionOrder.join(',');
  populateAdminVersionControls();
  renderAdminSongs();
  notifySuccess('Versão adicionada');
  input.value = '';
}

function readFileDataURL(input) {
  return new Promise((resolve, reject) => {
    if (!input || !input.files || !input.files[0]) { reject('no_file'); return; }
    const f = input.files[0];
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, data: r.result });
    r.onerror = () => reject('read_error');
    r.readAsDataURL(f);
  });
}

function adminUploadCover(inputId, targetInputId) {
  const input = document.getElementById(inputId);
  const target = document.getElementById(targetInputId);
  if (!input || !target) return;
  readFileDataURL(input).then(({ name, data }) => {
    socket.emit('uploadAsset', { kind: 'cover', filename: name, data }, (res) => {
      if (res && res.success) { target.value = res.url; notifySuccess('Capa enviada'); updateAdminAddPreviews(); updateAdminAddPreviewsCat(); }
      else { notifyError('Falha ao enviar capa'); }
    });
  });
}

function adminUploadVideo(inputId, targetInputId) {
  const input = document.getElementById(inputId);
  const target = document.getElementById(targetInputId);
  if (!input || !target) return;
  readFileDataURL(input).then(({ name, data }) => {
    socket.emit('uploadAsset', { kind: 'video', filename: name, data }, (res) => {
      if (res && res.success) { target.value = res.url; notifySuccess('Vídeo enviado'); updateAdminAddPreviews(); updateAdminAddPreviewsCat(); }
      else { notifyError('Falha ao enviar vídeo'); }
    });
  });
}

function adminUploadCoverForSong(id) {
  const input = document.getElementById('song_thumb_file_' + id);
  const target = document.getElementById('song_thumb_' + id);
  if (!input || !target) return;
  readFileDataURL(input).then(({ name, data }) => {
    socket.emit('uploadAsset', { kind: 'cover', filename: name, data }, (res) => {
      if (res && res.success) { target.value = res.url; notifySuccess('Capa enviada'); }
      else { notifyError('Falha ao enviar capa'); }
    });
  });
}

function adminUploadVideoForSong(id) {
  const input = document.getElementById('song_video_file_' + id);
  const target = document.getElementById('song_preview_' + id);
  if (!input || !target) return;
  readFileDataURL(input).then(({ name, data }) => {
    socket.emit('uploadAsset', { kind: 'video', filename: name, data }, (res) => {
      if (res && res.success) { target.value = res.url; notifySuccess('Vídeo enviado'); }
      else { notifyError('Falha ao enviar vídeo'); }
    });
  });
}

function adminCreateUser() {
  const u = document.getElementById('adminNewUser').value.trim();
  const p = document.getElementById('adminNewPass').value.trim();
  const r = document.getElementById('adminNewRole').value;
  const msg = document.getElementById('adminUserMsg');
  if (!u || !p) { msg.textContent = 'Usuário e senha obrigatórios'; return; }
  socket.emit('createUser', { username: u, password: p, role: r }, (res) => {
    if (res && res.success) {
      msg.textContent = '✅ Usuário criado';
      document.getElementById('adminNewUser').value = '';
      document.getElementById('adminNewPass').value = '';
      fetchAdminUsers();
    } else {
      msg.textContent = '❌ ' + (res && res.error ? res.error : 'Erro');
    }
  });
}

function fetchAdminUsers() {
  socket.emit('listUsers', {}, (res) => {
    if (res && res.success) {
      renderAdminUsers(res.users);
      const c = document.getElementById('adminUserCount'); if (c) c.textContent = String((res.users || []).length);
    } else {
      console.error('Erro listUsers', res);
    }
  });
}

function renderAdminUsers(users) {
  const list = document.getElementById('adminUsersList');
  if (!list) return;
  list.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>${u.username}</strong></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select onchange="adminChangeUserRole('${u.username}', this.value)">
            <option value="user" ${u.role==='user'? 'selected':''}>user</option>
            <option value="staff" ${u.role==='staff'? 'selected':''}>staff</option>
            <option value="admin" ${u.role==='admin'? 'selected':''}>admin</option>
          </select>
          <button class="queue-item-remove" onclick="adminRemoveUser('${u.username}')">Remover</button>
        </div>
      </div>
    `;
    list.appendChild(li);
  });
}

function adminChangeUserRole(username, role) {
  socket.emit('updateUserRole', { username, role }, (res) => {
    if (!res || !res.success) alert('Erro ao atualizar role');
    else fetchAdminUsers();
  });
}

function adminRemoveUser(username) {
  if (!confirm('Remover usuário ' + username + '?')) return;
  socket.emit('removeUser', username, (res) => {
    if (res && res.success) {
      fetchAdminUsers();
    } else {
      alert('Erro ao remover: ' + (res && res.error));
    }
  });
}

function renderQueue(queue) {
  const queueList = document.getElementById('queueList');
  const myEntry = document.getElementById('myEntry');
  const queueCount = document.getElementById('queueCount');

  queueList.innerHTML = '';
  myEntry.innerHTML = '';
  queueCount.textContent = queue.length;

  myQueuePosition = null;

  if (queue.length === 0) {
    queueList.innerHTML = '<li>Nenhum jogador na fila</li>';
    myEntry.innerHTML = '<p>Você ainda não está na fila</p>';
    return;
  }

  queue.forEach((entry, index) => {
    // Verificar se é o usuário atual
    const isMe = (entry.user === currentUser) || (entry.username === currentUser) || (entry.name === currentUser);
    if (isMe) {
      myQueuePosition = index + 1;
    }

    const li = document.createElement('li');
    if (isMe) li.classList.add('me');

    li.innerHTML = `
      <div class="queue-item-position">${index + 1}</div>
      <div class="queue-item-info">
        <div class="queue-item-name">${entry.name || entry.displayName || entry.username || entry.user}</div>
        <div class="queue-item-song">🎵 ${entry.song}</div>
      </div>
      <div class="queue-item-role role-${entry.role}">${entry.role.toUpperCase()}</div>
          ${(currentRole === 'admin' || currentRole === 'staff' || isMe) ? `
            <button class="queue-item-remove" onclick="removeFromQueue(${entry.id})">Remover</button>
          ` : ''}
    `;

    queueList.appendChild(li);
  });

  // Mostrar entrada do usuário
  if (myQueuePosition) {
    const myData = queue.find(e => e.user === currentUser);
    myEntry.innerHTML = `
      <div style="font-size: 1.2em; margin-bottom: 10px;">⭐ Você está na fila!</div>
      <div style="margin: 10px 0;">Posição: <strong>#${myQueuePosition}</strong></div>
      <div style="margin: 10px 0;">Música: <strong>${myData.song}</strong></div>
      <div style="margin-top: 12px;">
        <button class="btn btn-secondary" onclick="yieldTurn()">Ceder a vez</button>
      </div>
    `;
  }
}

function removeFromQueue(id) {
  const entry = (lastQueue || []).find(e => e.id === id);
  const isMe = entry && ((entry.user === currentUser) || (entry.username === currentUser) || (entry.name === currentUser));
  const canAdmin = (currentRole === 'admin' || currentRole === 'staff');
  if (!isMe && !canAdmin) {
    notifyError('Você não pode remover outro jogador da fila');
    return;
  }
  socket.emit('leave', { id }, (response) => {
    if (response.success) {
      // se removeu a própria entrada, voltar para seleção
      const removedWasMe = lastQueue.find(e => e.id === id && e.user === currentUser);
      if (removedWasMe) {
        currentSong = null;
        goToMusicSelect();
      }
    }
  });
}

function yieldTurn() {
  const myData = lastQueue.find(e => (e.user === currentUser) || (e.username === currentUser) || (e.name === currentUser));
  if (!myData) { notifyWarning('Você não está na fila'); return; }
  socket.emit('leave', { id: myData.id }, (response) => {
    if (response && response.success) {
      notifySuccess('Você cedeu a vez ao próximo');
      goToMenu();
    } else {
      notifyError('Erro ao ceder a vez');
    }
  });
}

function goToStaff() {
  showScreen('staffScreen');
  renderStaffQueue();
  updateStaffNextPlayer();
}

function updateStaffNextPlayer() {
  const div = document.getElementById('staffNextPlayer');
  if (!div) return;
  if (!lastQueue || lastQueue.length === 0) {
    div.innerHTML = '<div style="font-size:1.2em;font-weight:800;">Fila Vazia</div>';
    return;
  }
  const next = lastQueue[0];
  div.innerHTML = `
    <div style="font-size:1.4em;font-weight:900;color:#00ffff;">🎮 ${next.name || next.user}</div>
    <div style="margin-top:8px;color:#00ffff;font-size:0.95em;">Música: ${next.song}</div>
    <div style="margin-top:4px;color:#ffb700;font-size:0.85em;">Role: ${next.role.toUpperCase()}</div>
  `;
}

function staffCallNext() {
  // Se houver um jogador previamente chamado, abrir modal para registrar pontuação
  const callNextHelper = () => {
    socket.emit('nextPlayer', {}, (res) => {
      if (res && res.success) {
        console.log('Próximo jogador chamado:', res.player);
        updateStaffNextPlayer();
      } else {
        alert('Erro: ' + (res && res.error ? res.error : 'Não foi possível chamar'));
      }
    });
  };

  if (lastCalledPlayer) {
    showStaffScoreModal(lastCalledPlayer, (proceed) => {
      if (proceed) {
        callNextHelper();
      }
    });
  } else {
    callNextHelper();
  }
}

// ===== Staff score modal control =====
let _staffModalCallback = null;
function showStaffScoreModal(player, callback) {
  _staffModalCallback = callback;
  const modal = document.getElementById('staffScoreModal');
  const nameEl = document.getElementById('modalPlayerName');
  const input = document.getElementById('modalScoreInput');
  if (!modal || !nameEl || !input) return callback && callback(false);
  nameEl.textContent = `${player.name || player.user || player.username}`;
  input.value = '';
  modal.style.display = 'flex';
}

function hideStaffScoreModal() {
  const modal = document.getElementById('staffScoreModal');
  if (modal) modal.style.display = 'none';
  _staffModalCallback = null;
}

function submitStaffScore() {
  const input = document.getElementById('modalScoreInput');
  if (!input) return;
  const val = input.value.trim();
  if (val === '') { notifyWarning('Digite uma pontuação ou clique em Pular'); return; }
  const score = parseInt(val, 10);
  if (isNaN(score)) { notifyError('Pontuação inválida'); return; }

  if (!lastCalledPlayer) { notifyError('Nenhum jogador para registrar'); hideStaffScoreModal(); return; }
  const player = lastCalledPlayer;
  socket.emit('submitScore', { score, songId: player.songId, songTitle: player.song, userId: player.userId, username: player.user }, (res) => {
    if (res && res.success) {
      notifySuccess(`Pontuação ${score} registrada para ${player.name || player.user}`);
    } else {
      notifyError('Erro ao registrar pontuação: ' + (res && res.error ? res.error : 'Desconhecido'));
    }
    hideStaffScoreModal();
    if (_staffModalCallback) _staffModalCallback(true);
  });
}

function skipStaffScore() {
  hideStaffScoreModal();
  if (_staffModalCallback) _staffModalCallback(true);
}

function cancelStaffScore() {
  hideStaffScoreModal();
  if (_staffModalCallback) _staffModalCallback(false);
}

function goToAdmin() {
  showScreen('adminScreen');
  renderAdminQueue();
  // carregar dados iniciais do admin
  fetchAdminUsers();
  renderAdminSongs();
  loadEvents();
  loadVersionOrder();
  populateAdminVersionControls();
  // solicitar configurações atuais
  socket.emit('getEventSettings', {}, (res) => {
    if (res && res.success && res.settings) {
      const n = document.getElementById('eventNameInput');
      const m = document.getElementById('eventMaxPlayersInput');
      if (n) n.value = res.settings.name || '';
      if (m) m.value = res.settings.maxPlayers || '';
    }
  });
}
function goToAdminQueue(){
  showScreen('adminQueueScreen');
  renderAdminQueue();
}
function goToAdminUsers(){
  showScreen('adminUsersScreen');
  fetchAdminUsers();
}
function goToAdminAddSong(){
  showScreen('adminAddSongScreen');
  loadVersionOrder();
  populateAdminVersionControls();
  updateAdminAddPreviews();
}
function goToAdminCatalog(){
  showScreen('adminCatalogScreen');
  renderAdminSongs();
  loadVersionOrder();
  populateAdminVersionControls();
}
function goToAdminSettings(){
  showScreen('adminSettingsScreen');
  loadVersionOrder();
  populateAdminVersionControls();
  loadEvents();
}

function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-panel').forEach(p => p.style.display = 'none');
  const tabBtn = document.querySelector(`.admin-tab[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const panel = document.getElementById('adminTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (panel) panel.style.display = 'block';
}

function saveEventSettings() {
  const name = document.getElementById('eventNameInput').value;
  const maxP = parseInt(document.getElementById('eventMaxPlayersInput').value || '0', 10);
  socket.emit('saveEventSettings', { name, maxPlayers: maxP }, (res) => {
    if (res && res.success) {
      notifySuccess('Configurações salvas');
    } else {
      notifyError('Falha ao salvar configurações');
    }
  });
}

function renderStaffQueue() {
  const list = document.getElementById('staffQueueList');
  const countEl = document.getElementById('staffQueueCount');
  if (!list) return;
  list.innerHTML = '';
  if (!lastQueue || lastQueue.length === 0) {
    list.innerHTML = '<li>Nenhum jogador na fila</li>';
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (countEl) countEl.textContent = String(lastQueue.length);
  lastQueue.forEach((entry, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>#${idx+1}</strong> ${entry.name || entry.user} — 🎵 ${entry.song}</div>
        <div style="display:flex;gap:8px;">
          ${(currentRole === 'admin' || currentRole === 'staff') ? `<button class="queue-item-remove" onclick="removeFromQueue(${entry.id})">Remover</button>` : ``}
        </div>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderAdminQueue() {
  const list = document.getElementById('adminQueueList');
  const qc = document.getElementById('adminQueueCount');
  if (!list) return;
  list.innerHTML = '';
  if (!lastQueue || lastQueue.length === 0) {
    list.innerHTML = '<li>Nenhum jogador na fila</li>';
    if (qc) qc.textContent = '0';
    return;
  }
  if (qc) qc.textContent = String(lastQueue.length);
  lastQueue.forEach((entry, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>#${idx+1}</strong> ${entry.name || entry.user} — ${entry.song}</div>
        <div style="display:flex;gap:8px;"><button class="queue-item-remove" onclick="removeFromQueue(${entry.id})">Remover</button></div>
      </div>
    `;
    list.appendChild(li);
  });
}

function clearQueue() {
  socket.emit('clearQueue', {}, (response) => {
    if (response && response.success) {
      // será atualizado pelo evento 'queue'
    } else {
      alert('Não autorizado ou erro ao limpar fila');
    }
  });
}

// ===== LEADERBOARD =====
function openLeaderboard() {
  showScreen('leaderboardScreen');
  socket.emit('getLeaderboard', {}, (leaderboard) => {
    renderLeaderboard(leaderboard);
  });
}

function renderLeaderboard(leaderboard) {
  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!leaderboard || leaderboard.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">Nenhum jogador no ranking ainda</td></tr>';
    return;
  }
  
  leaderboard.forEach((player, index) => {
    const tr = document.createElement('tr');
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
    tr.innerHTML = `
      <td><strong>${medal}</strong></td>
      <td>${player.username}</td>
      <td><strong>${player.total_score || 0}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== TOURNAMENTS =====
function openTournaments() {
  showScreen('tournamentsScreen');
  if (currentEventId) {
    socket.emit('listTournamentsByEvent', { eventId: currentEventId }, (tRes)=>{
      if(tRes && tRes.success) currentTournaments = tRes.tournaments || [];
      renderTournaments();
    });
  } else {
    renderTournaments();
  }
}

// ===== CHAT =====
// chat removido

// ===== SCORE SUBMISSION =====
function openScoreSubmission() {
  const score = prompt('🎮 Digite sua pontuação:');
  if (score !== null && score.trim() !== '') {
    submitScore(parseInt(score, 10));
  }
}

function submitScore(score) {
  if (isNaN(score) || score < 0) {
    notifyError('Pontuação inválida!');
    return;
  }
  
  socket.emit('submitScore', { 
    score: score,
    songId: currentSong?.id || 0,
    songTitle: currentSong?.title || '',
    timestamp: new Date().toISOString()
  }, (response) => {
    if (response && response.success) {
      notifyScoreUpdate(currentUser, score);
      if (currentSong?.id) updateSongCardScore(currentSong.id, score);
    } else {
      notifyError('Erro ao registrar pontuação');
    }
  });
}
