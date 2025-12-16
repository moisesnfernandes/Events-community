const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.all('SELECT id, username, displayName, avatar FROM users', (err, rows)=>{
  if(err){ console.error('err', err); process.exit(1); }
  console.log(rows);
  process.exit(0);
});
