const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  let urlPath;
  try{
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  }catch(e){
    res.writeHead(400,{'Content-Type':'text/plain'});
    return res.end('Bad request');
  }
  if(urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(root, urlPath));
  const relative = path.relative(root, filePath);
  if(relative.startsWith('..') || path.isAbsolute(relative)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('File not found');}
    res.writeHead(200,{'Content-Type':types[path.extname(filePath).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
});
const port = process.env.PORT || 3000;
server.listen(port,()=>console.log(`MartAI running at http://localhost:${port}`));
