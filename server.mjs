import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGzip } from 'node:zlib';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, {});
    const name = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const file = path.resolve(publicDir, name);
    if (!file.startsWith(publicDir) || !mime[path.extname(file)]) return json(res, 404, {});
    const zippedFont = file.endsWith('.ttf') && /\bbr\b/.test(req.headers['accept-encoding'] ?? '');
    const gzipFont = !zippedFont && file.endsWith('.ttf') && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const servedFile = zippedFont ? file + '.br' : file;
    const stat = statSync(servedFile, { throwIfNoEntry: false });
    if (!stat?.isFile()) return json(res, 404, {});
    const media = /\.(webp|ttf)$/.test(file);
    const etag = '"' + stat.size.toString(16) + '-' + Math.trunc(stat.mtimeMs).toString(16) + (gzipFont ? '-gzip' : '') + '"';
    res.setHeader('Cache-Control', media ? 'public, max-age=3600' : 'no-cache');
    res.setHeader('ETag', etag);
    if (file.endsWith('.ttf')) res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    if (zippedFont || gzipFont) res.setHeader('Content-Encoding', zippedFont ? 'br' : 'gzip');
    if (!gzipFont) res.setHeader('Content-Length', stat.size);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
    if (req.method === 'HEAD') return res.end();
    const source = createReadStream(servedFile).on('error', () => res.destroy());
    if (gzipFont) source.pipe(createGzip()).on('error', () => res.destroy()).pipe(res);
    else source.pipe(res);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof URIError || error instanceof RangeError) return json(res, 400, {});
    console.error(error);
    if (!res.headersSent) json(res, 500, {}); else res.destroy();
  }
});
server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => {
  const { address, port } = server.address();
  console.log('램모으기 접수창구  http://' + address + ':' + port);
});
