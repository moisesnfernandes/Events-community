const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db', (e)=>{ if(e) return console.error('db open err',e); });

db.all("PRAGMA table_info('users')", (err, cols)=>{
  if(err) return console.error('pragma err', err);
  const names = cols.map(c=>c.name);
  const tasks = [];
  if(!names.includes('displayName')) tasks.push(new Promise((res,rej)=> db.run("ALTER TABLE users ADD COLUMN displayName TEXT", (e)=> e ? rej(e) : res())));
  if(!names.includes('avatar')) tasks.push(new Promise((res,rej)=> db.run("ALTER TABLE users ADD COLUMN avatar TEXT", (e)=> e ? rej(e) : res())));
  if(tasks.length===0){ console.log('columns already present'); process.exit(0); }
  Promise.all(tasks).then(()=>{ console.log('columns added'); process.exit(0); }).catch(e=>{ console.error('add col err', e); process.exit(1); });
});
