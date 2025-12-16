const io = require('socket.io-client');

function adminCreateThenUserJoin() {
  const admin = io('http://localhost:3000');
  admin.on('connect', ()=>{
    admin.emit('login', { username: 'admin', password: 'admin123' }, (res)=>{
      console.log('admin login', res && res.success);
      const code = 'E2E' + Math.floor(Math.random()*900+100);
      admin.emit('createEvent', { code, name: 'E2E Event '+code, maxPlayers: 50, active: 1 }, (cRes)=>{
        console.log('createEvent', cRes);
        // now simulate a user joining
        const user = io('http://localhost:3000');
        user.on('connect', ()=>{
          user.emit('login', { username: 'user', password: 'user123' }, (uRes)=>{
            console.log('user login', uRes && uRes.success);
            // pick a song from songs.json by requesting via admin socket
            admin.emit('getEventByCode', { code }, (gRes)=>{
              console.log('getEventByCode', gRes);
              // choose a dummy song
              const payload = { name: 'user', displayName: 'PlayerUser', songId: 1, song: 'Test Song', eventCode: code };
              user.emit('join', payload, (joinRes)=>{
                console.log('joinRes', joinRes);
                process.exit(0);
              });
            });
          });
        });
      });
    });
  });
}

adminCreateThenUserJoin();
