const io = require('socket.io-client');
const socket = io('http://localhost:3000');
let timedOut = false;
const t = setTimeout(()=>{ timedOut=true; console.error('Timeout connecting'); process.exit(1); }, 10000);
socket.on('connect', ()=>{
  clearTimeout(t);
  console.log('connected');
  socket.emit('login',{ username: 'user', password: 'user123' }, (res)=>{
    console.log('login:', res);
    if(!res || !res.success){ console.error('Login failed'); socket.disconnect(); process.exit(1); }
    socket.emit('updateProfile', { displayName: 'Teste Save', avatar: '😎' }, (r2)=>{
      console.log('updateProfile:', r2);
      socket.emit('getProfile', {}, (r3)=>{
        console.log('getProfile:', r3);
        socket.disconnect();
        process.exit(0);
      });
    });
  });
});
socket.on('connect_error', (e)=>{ console.error('connect_error', e); });
