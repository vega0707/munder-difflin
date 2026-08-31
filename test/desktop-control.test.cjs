'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  mapDesktopError,
  DesktopError,
  invokeDesktopTool,
  _setNutForTest,
  _resetNutForTest
} = loadTs('src/main/desktopControl.ts');

test('mapDesktopError maps accessibility failures to DESKTOP_PERMISSION_DENIED', () => {
  const mapped = mapDesktopError(new Error('AXError: accessibility API disabled'));
  assert.equal(mapped.code, 'DESKTOP_PERMISSION_DENIED');
  assert.match(mapped.message, /Accessibility permission required/i);
});

test('mapDesktopError preserves DesktopError instances', () => {
  const original = new DesktopError('DESKTOP_BAD_REQUEST', 'bad coords');
  assert.equal(mapDesktopError(original), original);
});

test('invokeDesktopTool rejects unknown methods', async () => {
  await assert.rejects(
    () => invokeDesktopTool('desktop_fly', {}),
    (err) => err instanceof DesktopError && err.code === 'DESKTOP_BAD_REQUEST'
  );
});

test('invokeDesktopTool maps nut load failure to DESKTOP_UNAVAILABLE', async () => {
  _setNutForTest(null, 'native module missing');
  try {
    await assert.rejects(
      () => invokeDesktopTool('desktop_move', { x: 1, y: 2 }),
      (err) => err instanceof DesktopError && err.code === 'DESKTOP_UNAVAILABLE'
    );
  } finally {
    _resetNutForTest();
  }
});

test('invokeDesktopTool maps nut runtime permission errors', async () => {
  _setNutForTest({
    mouse: {
      setPosition: async () => {
        throw new Error('not authorized to control assistive devices');
      }
    },
    Point: class Point {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    }
  });
  try {
    await assert.rejects(
      () => invokeDesktopTool('desktop_move', { x: 10, y: 20 }),
      (err) => err instanceof DesktopError && err.code === 'DESKTOP_PERMISSION_DENIED'
    );
  } finally {
    _resetNutForTest();
  }
});
