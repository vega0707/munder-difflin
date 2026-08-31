'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseBridgeMessage, isValidToken } = require('../out/main/browserBridgeProtocol.cjs');

describe('browserBridgeProtocol', () => {
  it('parses hello message', () => {
    const msg = parseBridgeMessage(JSON.stringify({ type: 'hello', token: 'abc', extensionVersion: '0.1.0' }));
    assert.equal(msg.type, 'hello');
  });
  it('rejects missing token', () => {
    assert.equal(isValidToken('', 'abc'), false);
    assert.equal(isValidToken('abc', 'abc'), true);
  });
});
