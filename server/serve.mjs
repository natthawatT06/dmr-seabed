import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
await stat(resolve(root,'index.html')).catch(()=>{throw new Error('Run npm run build first');});
const server=createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const pathname=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname);
    if(pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
    let file=resolve(root,`.${pathname}`);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    try {if(!(await stat(file)).isFile())file=resolve(root,'index.html');}
    catch {if(extname(pathname)){res.writeHead(404);res.end();return;}file=resolve(root,'index.html');}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream',
      'Cache-Control':file.includes(`${sep}assets${sep}`)?'public, max-age=31536000, immutable':'no-cache',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Length':body.length});
    res.end(req.method==='HEAD'?undefined:body);
  } catch {if(!res.headersSent)res.writeHead(500);res.end('Request failed');}
});
const port=Number(process.env.PORT??3001),host=process.env.HOST??'127.0.0.1';
server.listen(port,host,()=>console.log(`DMR Seabed: http://${host}:${port}`));
function stop(){server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
