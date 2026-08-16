const http = require('http');
const u = 'http://192.168.1.33:20130';
const k = 'sk-a9199bb7b055a6d0-j03vej-95a27b54';
const x = http.get(u + '/v1/models', { headers: { Authorization: 'Bearer ' + k } }, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      const ids = j.data.map((m) => m.id);
      console.log('count=' + ids.length);
      console.log(ids.join('\n'));
    } catch (e) { console.log('parse err', d.slice(0, 500)); }
  });
});
x.on('error', (e) => console.log('ERR ' + e.code));
x.setTimeout(8000, () => { x.destroy(); console.log('TIMEOUT'); });