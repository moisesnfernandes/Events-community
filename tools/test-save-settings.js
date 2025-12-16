const io = require('socket.io-client');

const socket = io('http://localhost:3000', { reconnectionDelayMax: 10000 });

socket.on('connect', () => {
  console.log('connected, socket id', socket.id);
  // login como admin
  socket.emit('login', { username: 'admin', password: 'admin123' }, (res) => {
    console.log('login response:', res);
    if (!res || !res.success) {
      console.error('login failed');
      socket.close();
      process.exit(1);
      return;
    }

    // enviar saveEventSettings
    const payload = { name: 'Evento Teste E2E', maxPlayers: 42 };
    socket.emit('saveEventSettings', payload, (saveRes) => {
      console.log('saveEventSettings response:', saveRes);

      // pedir as configs de volta
      socket.emit('getEventSettings', {}, (getRes) => {
        console.log('getEventSettings response:', getRes);
        socket.close();
        process.exit(0);
      });
    });
  });
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err.message);
  process.exit(1);
});
