import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.json':'application/json',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
};
const PORT = process.env.PORT || 8080;

http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p === '/') p = '/index.html';
  const full = path.join(root, p);
  if(!full.startsWith(root)){ res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, data)=>{
    if(err){ res.writeHead(404); return res.end('not found: '+p); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, ()=>console.log('serving', root, 'on', PORT));
