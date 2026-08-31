'use strict';

// Activity tab log lines used to clip with ellipsis and the shared Scroll
// pane sets overflowX:hidden. Long JSON (archive / role / app-start) then
// cannot be panned. These checks pin the ActivityTab body itself: rows must
// expose a horizontal scroll, and must not clip with ellipsis.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../src/renderer/src/components/CommandCenterPanel.tsx'),
  'utf8'
);

function activityTabBody() {
  const start = src.indexOf('function ActivityTab');
  assert.ok(start >= 0, 'ActivityTab vanished');
  const next = src.indexOf('\nfunction ', start + 1);
  assert.ok(next > start, 'ActivityTab has no following function to bound it');
  return src.slice(start, next);
}

test('activity log rows scroll horizontally instead of clipping with ellipsis', () => {
  const body = activityTabBody();
  assert.match(body, /overflowX:\s*'auto'/,
    'ActivityTab log rows must allow horizontal panning for long JSON');
  assert.doesNotMatch(body, /textOverflow:\s*'ellipsis'/,
    'ellipsis on log lines hides the tail and makes overflowX a no-op');
  assert.doesNotMatch(body, /overflow:\s*'hidden'/,
    'overflow:hidden on log lines swallows the extra width');
});
