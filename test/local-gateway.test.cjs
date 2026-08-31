'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const loadTs = require('./load-ts.cjs');

const { LocalGateway, mintGatewayToken } = loadTs('src/main/localGateway.ts');

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch { /* leave null */ }
        resolve({ status: res.statusCode, json, body });
      });
    }).on('error', reject);
  });
}

test('mintGatewayToken returns hex', () => {
  const t = mintGatewayToken();
  assert.match(t, /^[a-f0-9]{48}$/);
});

test('LocalGateway health + tasks with bearer', async () => {
  const token = 'test-token-abc';
  const gw = new LocalGateway({
    port: 0,
    token,
    getTasks: () => [{ id: 't1', title: 'Ask', status: 'blocked', assignee: 'pam' }]
  });
  const started = await gw.start();
  assert.equal(started.ok, true);
  assert.ok(started.port > 0);

  const denied = await get(started.port, '/health');
  assert.equal(denied.status, 401);

  const health = await get(started.port, '/health', { Authorization: `Bearer ${token}` });
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.service, 'munder-local-gateway');

  const tasks = await get(started.port, '/tasks', { 'x-md-gateway-token': token });
  assert.equal(tasks.status, 200);
  assert.equal(tasks.json.tasks.length, 1);
  assert.equal(tasks.json.tasks[0].id, 't1');

  const missing = await get(started.port, '/nope', { Authorization: `Bearer ${token}` });
  assert.equal(missing.status, 404);

  gw.stop();
});
