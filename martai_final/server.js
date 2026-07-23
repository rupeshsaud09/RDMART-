const http = require('http');
const fs = require('fs');
const path = require('path');
let dailySummaryHandler = null;
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://api.qrserver.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'");
  let urlPath;
  try{
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  }catch(e){
    res.writeHead(400,{'Content-Type':'text/plain'});
    return res.end('Bad request');
  }
  if(urlPath === '/api/daily-summary'){
    try{
      dailySummaryHandler=dailySummaryHandler||require('../api/daily-summary');
      return dailySummaryHandler(req,res);
    }catch(error){
      res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ok:false,error:'Daily summary service could not start.'}));
    }
  }
  if(urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(root, urlPath));
  const relative = path.relative(root, filePath);
  if(relative.startsWith('..') || path.isAbsolute(relative)){res.writeHead(403);return res.end('Forbidden');}
  const segments=relative.split(path.sep);
  if(segments.some(segment=>segment.startsWith('.'))||path.extname(filePath).toLowerCase()==='.sql'){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('File not found');}
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('File not found');}
    if(path.extname(filePath).toLowerCase()==='.html'||urlPath==='/sw.js')res.setHeader('Cache-Control','no-store, must-revalidate');
    res.writeHead(200,{'Content-Type':types[path.extname(filePath).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
});
const port = process.env.PORT || 3000;
server.listen(port,()=>console.log(`KHATA PANA running at http://localhost:${port}`));
