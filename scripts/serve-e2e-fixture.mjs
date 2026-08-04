import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const fixtureRoutes = new Map([
  [
    '/interactive-page.html',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/interactive-page.html', import.meta.url)),
      contentType: 'text/html; charset=utf-8',
    },
  ],
  [
    '/archive-page.html',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/archive-page.html', import.meta.url)),
      contentType: 'text/html; charset=utf-8',
    },
  ],
  [
    '/assets/interactive.js',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/assets/interactive.js', import.meta.url)),
      contentType: 'text/javascript; charset=utf-8',
    },
  ],
  [
    '/offline-page.html',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/offline-page.html', import.meta.url)),
      contentType: 'text/html; charset=utf-8',
    },
  ],
  [
    '/sensitive-form-page.html',
    {
      path: fileURLToPath(
        new URL('../tests/e2e/fixtures/sensitive-form-page.html', import.meta.url),
      ),
      contentType: 'text/html; charset=utf-8',
    },
  ],
  [
    '/assets/offline.css',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/assets/offline.css', import.meta.url)),
      contentType: 'text/css; charset=utf-8',
    },
  ],
  [
    '/assets/logo.svg',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/assets/logo.svg', import.meta.url)),
      contentType: 'image/svg+xml',
    },
  ],
  [
    '/assets/background.svg',
    {
      path: fileURLToPath(new URL('../tests/e2e/fixtures/assets/background.svg', import.meta.url)),
      contentType: 'image/svg+xml',
    },
  ],
]);
const host = '127.0.0.1';
const port = 4173;

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  const fixture = fixtureRoutes.get(request.url ?? '');
  if (fixture) {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': fixture.contentType,
    });
    createReadStream(fixture.path).pipe(response);
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('not found');
});

server.listen(port, host, () => {
  console.log(`SiteCapsule E2E fixture listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
