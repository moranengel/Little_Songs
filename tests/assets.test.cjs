const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw = fs.readFileSync(path.join(root,'sw.js'),'utf8');
const shell = JSON.parse(sw.match(/const SHELL = (.*);/)[1]);
for (const file of ['style.css','backup.js','app.js']) {
 const content = fs.readFileSync(path.join(root,file));
 const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0,12);
 const ext = path.extname(file); const ref = './assets/'+path.basename(file,ext)+'-'+hash+ext;
 assert.ok(html.includes(ref),'HTML must load the matching content-addressed '+file);
 assert.ok(shell.includes(ref),'Offline shell must include '+ref);
 assert.deepEqual(fs.readFileSync(path.join(root,ref)),content);
 assert.ok(!html.includes('"./'+file+'"'),'Avoid the old cache-first asset URL for '+file);
}
console.log('PASS: HTML, source bytes and offline shell use matching versioned assets.');
