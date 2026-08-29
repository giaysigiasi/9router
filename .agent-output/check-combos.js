const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/app/data/db/data.sqlite');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t=>t.name).join(', '));
for (const t of tables) {
  if (t.name.toLowerCase().includes('combo')) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    console.log(t.name + ' columns:', cols.map(c=>c.name).join(', '));
    const rows = db.prepare('SELECT * FROM ' + t.name).all();
    const roleRows = rows.filter(r => /-(pm|ba|dev|qa|supervisor)$/.test(r.name || ''));
    console.log('  Total rows: ' + rows.length + ', Role rows: ' + roleRows.length);
    for (const r of roleRows) {
      console.log('  ' + r.name + ' (id=' + r.id + ')');
    }
  }
}
db.close();
