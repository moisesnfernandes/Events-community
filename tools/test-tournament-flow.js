const io = require('socket.io-client');

function testTournamentFlow() {
  const admin = io('http://localhost:3000');
  admin.on('connect', ()=>{
    admin.emit('login', { username: 'admin', password: 'admin123' }, (res)=>{
      console.log('✅ admin login');
      const evCode = 'TOUR' + Math.floor(Math.random()*900+100);
      admin.emit('createEvent', { code: evCode, name: 'Evento Torneio', maxPlayers: 50, active: 1 }, (cRes)=>{
        console.log('✅ evento criado:', cRes.id);
        // criar torneio para este evento
        admin.emit('createTournament', { eventId: cRes.id, name: 'Torneio Principal', type: 'single_elimination', maxParticipants: 8 }, (tRes)=>{
          console.log('✅ torneio criado:', tRes.id);
          // agora usuario entra no evento
          const user = io('http://localhost:3000');
          user.on('connect', ()=>{
            user.emit('login', { username: 'user', password: 'user123' }, (uRes)=>{
              console.log('✅ user login');
              // user pega torneis do evento
              user.emit('listTournamentsByEvent', { eventId: cRes.id }, (lRes)=>{
                console.log('✅ torneios do evento:', lRes.tournaments.length);
                console.log('Torneios:', lRes.tournaments.map(t=>({name:t.name, type:t.type})));
                process.exit(0);
              });
            });
          });
        });
      });
    });
  });
}

testTournamentFlow();
