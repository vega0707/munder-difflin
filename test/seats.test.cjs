'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  emptySeatBoard, occupancyFor, applyClaim, applyVacate, applyHeartbeat,
  isLeaseExpired, leaseRemainingMs, SEAT_LEASE_TTL_MS, isSeatPathId
} = loadTs('src/shared/seats.ts');

test('an empty seat is vacant', () => {
  assert.equal(occupancyFor(undefined, 'rt-a'), 'vacant');
  assert.equal(occupancyFor({}, 'rt-a'), 'vacant');
});

test('claimedBy matching this runtime is local; anyone else is remote', () => {
  const local = applyClaim(emptySeatBoard(), 'jim', 'rt-a', { hostLabel: 'desk', now: 1_000 });
  assert.equal(local.ok, true);
  assert.equal(occupancyFor(local.board.seats.jim, 'rt-a', 1_000), 'local');
  assert.equal(occupancyFor(local.board.seats.jim, 'rt-b', 1_000), 'remote');
});

test('claim refuses a seat held by another runtime unless forced', () => {
  const held = applyClaim(emptySeatBoard(), 'jim', 'rt-a', { now: 1 });
  const blocked = applyClaim(held.board, 'jim', 'rt-b', { now: 2 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'SEAT_TAKEN');
  const stolen = applyClaim(held.board, 'jim', 'rt-b', { force: true, hostLabel: 'other', now: 3 });
  assert.equal(stolen.ok, true);
  assert.equal(stolen.board.seats.jim.claimedBy, 'rt-b');
});

test('vacate only works for the holder, unless forced', () => {
  const held = applyClaim(emptySeatBoard(), 'pam', 'rt-a', { now: 10 });
  const refused = applyVacate(held.board, 'pam', 'rt-b', { now: 11 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SEAT_NOT_HELD');
  const left = applyVacate(held.board, 'pam', 'rt-a', { now: 12 });
  assert.equal(left.ok, true);
  assert.equal(occupancyFor(left.board.seats.pam, 'rt-a', 12), 'vacant');
});

test('an expired lease is vacant and can be claimed without force', () => {
  const t0 = 1_000_000;
  const held = applyClaim(emptySeatBoard(), 'dwight', 'rt-a', { now: t0, ttlMs: 90_000, hostLabel: 'laptop' });
  assert.equal(held.ok, true);
  assert.equal(isLeaseExpired(held.board.seats.dwight, t0 + 89_000), false);
  assert.equal(occupancyFor(held.board.seats.dwight, 'rt-b', t0 + 89_000), 'remote');
  const later = t0 + 90_001;
  assert.equal(isLeaseExpired(held.board.seats.dwight, later), true);
  assert.equal(occupancyFor(held.board.seats.dwight, 'rt-b', later), 'vacant');
  const takeover = applyClaim(held.board, 'dwight', 'rt-b', { now: later, hostLabel: 'cursor-box' });
  assert.equal(takeover.ok, true);
  assert.equal(takeover.board.seats.dwight.claimedBy, 'rt-b');
  assert.equal(takeover.board.seats.dwight.hostLabel, 'cursor-box');
});

test('heartbeat extends the lease; a stranger cannot heartbeat', () => {
  const t0 = 5_000;
  const held = applyClaim(emptySeatBoard(), 'angela', 'rt-a', { now: t0, ttlMs: 1_000 });
  const beat = applyHeartbeat(held.board, 'angela', 'rt-a', { now: t0 + 800, ttlMs: 1_000 });
  assert.equal(beat.ok, true);
  assert.equal(leaseRemainingMs(beat.board.seats.angela, t0 + 800), 1_000);
  assert.equal(occupancyFor(beat.board.seats.angela, 'rt-b', t0 + 1_500), 'remote');
  const stranger = applyHeartbeat(held.board, 'angela', 'rt-b', { now: t0 + 100 });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, 'SEAT_NOT_HELD');
});

test('legacy records without leaseUntil expire from claimedAt + TTL', () => {
  const rec = { claimedBy: 'rt-a', claimedAt: 100, hostLabel: 'old' };
  assert.equal(isLeaseExpired(rec, 100 + SEAT_LEASE_TTL_MS - 1), false);
  assert.equal(isLeaseExpired(rec, 100 + SEAT_LEASE_TTL_MS + 1), true);
});

test('seat path ids accept uuid and office names, reject slashes', () => {
  assert.equal(isSeatPathId('god'), true);
  assert.equal(isSeatPathId('jim'), true);
  assert.equal(isSeatPathId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), true);
  assert.equal(isSeatPathId('a/b'), false);
  assert.equal(isSeatPathId(''), false);
});
