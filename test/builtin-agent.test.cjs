'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { draftBuiltinReply, builtinShouldReply } = loadTs('src/shared/builtinAgent.ts');
const { isAgentProvider, inferAgentProvider, canReceiveInbox, providerNeedsPty } =
  loadTs('src/shared/agentProvider.ts');

test('builtin is a selectable inbox-capable provider with no PTY', () => {
  assert.equal(isAgentProvider('builtin'), true);
  assert.equal(inferAgentProvider('builtin'), 'builtin');
  assert.equal(canReceiveInbox('builtin'), true);
  assert.equal(providerNeedsPty('builtin'), false);
  assert.equal(providerNeedsPty('claude'), true);
});

test('builtin replies to request/query/propose and stays quiet on inform/done', () => {
  assert.equal(builtinShouldReply('request'), true);
  assert.equal(builtinShouldReply('inform'), false);
  assert.equal(builtinShouldReply('done'), false);
  const reply = draftBuiltinReply(
    { id: 'm1', from: 'god', to: 'jim', act: 'request', subject: 'ship it', body: 'please' },
    { id: 'jim', name: 'Jim' }
  );
  assert.ok(reply);
  assert.equal(reply.to, 'god');
  assert.equal(reply.act, 'done');
  assert.equal(reply.in_reply_to, 'm1');
  assert.match(reply.body, /built-in office agent/i);
  assert.equal(
    draftBuiltinReply(
      { id: 'm2', from: 'god', to: 'jim', act: 'inform', subject: 'fyi', body: 'x' },
      { id: 'jim', name: 'Jim' }
    ),
    null
  );
});
