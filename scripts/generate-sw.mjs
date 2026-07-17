import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dist = path.resolve('dist');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const files = walk(dist)
  .filter((file) => !file.endsWith('sw.js'))
  .map((file) => '/' + path.relative(dist, file).replaceAll(path.sep, '/'));
const version = crypto.createHash('sha1').update(files.join('|') + Date.now()).digest('hex').slice(0, 10);
const sw = `const CACHE='peon-v13-${version}';\nconst APP_SHELL=${JSON.stringify(files)};\nself.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});\nself.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('peon-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});\nself.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;if(req.mode==='navigate'){event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy));return res}).catch(()=>caches.match('/index.html')));return;}event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})))})`; 
fs.writeFileSync(path.join(dist, 'sw.js'), sw);
console.log(`Generated offline service worker with ${files.length} files (${version})`);
