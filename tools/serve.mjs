/**
 * Zero-dependency static server for local preview (no dependencies — Node's
 * built-in http + fs only).
 *
 *   node tools/serve.mjs        # then open http://localhost:8000
 *   node tools/serve.mjs 3000   # or pick your own port
 *
 * The page also works when opened straight off disk (index.html loads
 * js/main.js as a classic script and every asset is a local relative path),
 * so this is only needed when you want a real http:// origin.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, ''));

  /* Never serve anything outside the project folder */
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(port, () => {
  console.log('\n  Serving ' + root);
  console.log('  -> http://localhost:' + port + '\n');
});
