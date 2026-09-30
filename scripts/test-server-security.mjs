import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer, preview, resolveConfig } from 'vite';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
assert.equal(manifest.scripts.dev, 'vite');
assert.equal(manifest.scripts.preview, 'vite preview --port 3000');

const originalHost = process.env.VITE_HOST;
const originalPort = process.env.VITE_PORT;
try {
  delete process.env.VITE_HOST;
  delete process.env.VITE_PORT;
  const defaults = await resolveConfig({}, 'serve');
  assert.equal(defaults.server.host, '127.0.0.1');
  assert.equal(defaults.server.port, 3000);
  assert.notEqual(defaults.server.allowedHosts, true);
  assert.notEqual(defaults.preview.host, '0.0.0.0');

  process.env.VITE_HOST = '0.0.0.0';
  process.env.VITE_PORT = '5123';
  const explicit = await resolveConfig({}, 'serve');
  assert.equal(explicit.server.host, '0.0.0.0');
  assert.equal(explicit.server.port, 5123);
  delete process.env.VITE_HOST;
  delete process.env.VITE_PORT;

  function request(port, host) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', headers: { Host: host } }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
  }

  const dev = await createServer({
    server: { port: 0, preTransformRequests: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
  });
  try {
    await dev.listen();
    const address = dev.httpServer.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(await request(address.port, 'localhost'), 200);
    assert.equal(await request(address.port, '127.0.0.1'), 200);
    assert.equal(await request(address.port, 'untrusted.invalid'), 403);
  } finally {
    await dev.close();
  }

  const built = await preview({ preview: { port: 0 }, logLevel: 'silent' });
  try {
    const address = built.httpServer.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(await request(address.port, 'localhost'), 200);
    assert.equal(await request(address.port, 'untrusted.invalid'), 403);
  } finally {
    await built.close();
  }
  console.log('PASS: dev and preview bind to loopback, reject untrusted hosts, and preserve explicit dev overrides.');
} finally {
  if (originalHost === undefined) delete process.env.VITE_HOST;
  else process.env.VITE_HOST = originalHost;
  if (originalPort === undefined) delete process.env.VITE_PORT;
  else process.env.VITE_PORT = originalPort;
}
