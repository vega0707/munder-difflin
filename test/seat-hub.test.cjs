'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { SeatHub, MemorySeatStore, parseSeatHubPath } = loadTs('src/main/seatHub.ts');

const TOKEN = 'seat-hub-token-abcdefghijklmnopqrstuvwxyz';

function makeHub(port = 0) {
  const store = new MemorySeatStore();
  const hub = new SeatHub({
    port,
    bind: '127.0.0.1',
    token: () => TOKEN,
    store
  });
  return { hub, store };
}

test('parseSeatHubPath routes floors, seats, and actions', () => {
  assert.deepEqual(parseSeatHubPath('/health'), { kind: 'health' });
  assert.deepEqual(parseSeatHubPath('/floors'), { kind: 'floors' });
  assert.deepEqual(parseSeatHubPath('/floors/proj-1'), { kind: 'floor', projectId: 'proj-1' });
  assert.deepEqual(parseSeatHubPath('/floors/proj-1/seats'), { kind: 'seats', projectId: 'proj-1' });
  assert.deepEqual(parseSeatHubPath('/floors/proj-1/seats/jim/claim'), {
    kind: 'seat', projectId: 'proj-1', agentId: 'jim', action: 'claim'
  });
  assert.equal(parseSeatHubPath('/floors/proj/seats/a/nope'), null);
  assert.equal(parseSeatHubPath('/nope'), null);
});

test('SeatHub claim, heartbeat, expire-and-takeover, handoff roundtrip', async () => {
  const { hub } = makeHub(0);
  const started = await hub.start();
  assert.equal(started.ok, true);
  const base = started.url;
  const headers = { 'content-type': 'application/json', 'x-md-seat-token': TOKEN };
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);

    const denied = await fetch(`${base}/floors`, { headers: { 'x-md-seat-token': 'wrong-token-abcdefghijklmnopqrstuvw' } });
    assert.equal(denied.status, 401);

    const putFloor = await fetch(`${base}/floors/office-a`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: 'Scranton',
        godCharacter: 'michael',
        agents: [{ agentId: 'jim', name: 'Jim', provider: 'claude' }]
      })
    });
    assert.equal(putFloor.status, 200);

    const claimA = await fetch(`${base}/floors/office-a/seats/jim/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-laptop', hostLabel: 'claude-laptop', provider: 'claude', now: 1_000 })
    });
    const claimABody = await claimA.json();
    assert.equal(claimA.status, 200);
    assert.equal(claimABody.ok, true);

    const blocked = await fetch(`${base}/floors/office-a/seats/jim/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-cursor', hostLabel: 'cursor-box', now: 2_000 })
    });
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.code, 'SEAT_TAKEN');

    const beat = await fetch(`${base}/floors/office-a/seats/jim/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-laptop', now: 3_000 })
    });
    assert.equal(beat.status, 200);

    const pack = {
      version: 2,
      exportedAt: 4_000,
      runtimeId: 'rt-laptop',
      projectId: 'office-a',
      agentId: 'jim',
      identity: '# Jim',
      memory: 'sold paper',
      cwd: '/Users/pam/paper',
      provider: 'claude'
    };
    const putHandoff = await fetch(`${base}/floors/office-a/seats/jim/handoff`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(pack)
    });
    assert.equal(putHandoff.status, 200);

    const got = await fetch(`${base}/floors/office-a/seats/jim/handoff`, { headers });
    const gotBody = await got.json();
    assert.equal(got.status, 200);
    assert.equal(gotBody.handoff.memory, 'sold paper');
    assert.equal(gotBody.handoff.cwd, '/Users/pam/paper');

    // Vacate (simulates graceful shutdown). A crash would instead wait for TTL.
    const vacated = await fetch(`${base}/floors/office-a/seats/jim/vacate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-laptop' })
    });
    assert.equal((await vacated.json()).ok, true);

    const take = await fetch(`${base}/floors/office-a/seats/jim/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-cursor', hostLabel: 'cursor-box', provider: 'cursor' })
    });
    const takeBody = await take.json();
    assert.equal(take.status, 200);
    assert.equal(takeBody.ok, true);

    const floors = await (await fetch(`${base}/floors`, { headers })).json();
    assert.equal(floors.floors.length, 1);
    assert.equal(floors.floors[0].name, 'Scranton');
  } finally {
    hub.stop();
  }
});

test('expired lease on the hub can be claimed by another runtime without vacate', async () => {
  const { hub, store } = makeHub(0);
  const started = await hub.start();
  assert.equal(started.ok, true);
  const base = started.url;
  const headers = { 'content-type': 'application/json', 'x-md-seat-token': TOKEN };
  try {
    const { applyClaim } = loadTs('src/shared/seats.ts');
    const { emptySeatBoard } = loadTs('src/shared/seats.ts');
    const t0 = Date.now() - 120_000;
    const planted = applyClaim(emptySeatBoard(), 'pam', 'rt-dead', { now: t0, ttlMs: 90_000, hostLabel: 'powered-off' });
    store.writeBoard('floor-b', planted.board);

    const take = await fetch(`${base}/floors/floor-b/seats/pam/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'rt-alive', hostLabel: 'other-desk' })
    });
    const body = await take.json();
    assert.equal(take.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
  } finally {
    hub.stop();
  }
});
