'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { emptySeatBoard, occupancyFor, applyClaim, applyVacate } = loadTs('src/shared/seats.ts');

test('an empty seat is vacant', () => {
  assert.equal(occupancyFor(undefined, 'rt-a'), 'vacant');
  assert.equal(occupancyFor({}, 'rt-a'), 'vacant');
});

test('claimedBy matching this runtime is local; anyone else is remote', () => {
  const local = applyClaim(emptySeatBoard(), 'jim', 'rt-a', { hostLabel: 'desk' });
  assert.equal(local.ok, true);
  assert.equal(occupancyFor(local.board.seats.jim, 'rt-a'), 'local');
  assert.equal(occupancyFor(local.board.seats.jim, 'rt-b'), 'remote');
});

test('claim refuses a seat held by another runtime unless forced', () => {
  const held = applyClaim(emptySeatBoard(), 'jim', 'rt-a', { now: 1 });
  const blocked = applyClaim(held.board, 'jim', 'rt-b');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'SEAT_TAKEN');
  const stolen = applyClaim(held.board, 'jim', 'rt-b', { force: true, hostLabel: 'other' });
  assert.equal(stolen.ok, true);
  assert.equal(stolen.board.seats.jim.claimedBy, 'rt-b');
});

test('vacate only works for the holder, unless forced', () => {
  const held = applyClaim(emptySeatBoard(), 'pam', 'rt-a');
  const refused = applyVacate(held.board, 'pam', 'rt-b');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SEAT_NOT_HELD');
  const left = applyVacate(held.board, 'pam', 'rt-a');
  assert.equal(left.ok, true);
  assert.equal(occupancyFor(left.board.seats.pam, 'rt-a'), 'vacant');
});
