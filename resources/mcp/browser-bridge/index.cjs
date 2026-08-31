#!/usr/bin/env node
'use strict';

/**
 * stdio MCP server — forwards browser_* tools to the Electron automation socket.
 *
 * Env (set by hive at spawn):
 *   MUNDER_AUTOMATION_SOCK — Unix socket / named pipe to automationBridge.ts
 *   MUNDER_APP_ROOT        — app dir for resolving @modelcontextprotocol/sdk (packaged)
 */
const { createConnection } = require('node:net');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

function appRootsForRequire() {
  const roots = [];
  if (process.env.MUNDER_APP_ROOT) roots.push(process.env.MUNDER_APP_ROOT);
  // Dev repo: resources/mcp/browser-bridge → project root
  roots.push(path.join(__dirname, '..', '..', '..'));
  // Packaged extraResources: .../Resources/mcp/browser-bridge → app.asar.unpacked
  roots.push(path.join(__dirname, '..', '..', 'app.asar.unpacked'));
  roots.push(path.join(__dirname, '..', '..'));
  return roots;
}

function requireSdk(subpath) {
  const pkg = `@modelcontextprotocol/sdk/${subpath}`;
  for (const root of appRootsForRequire()) {
    try {
      return require(require.resolve(pkg, { paths: [root] }));
    } catch { /* try next root */ }
  }
  process.stderr.write(
    'browser-bridge MCP: cannot find @modelcontextprotocol/sdk; set MUNDER_APP_ROOT\n'
  );
  process.exit(1);
}

const { McpServer } = requireSdk('server/mcp.js');
const { StdioServerTransport } = requireSdk('server/stdio.js');

function automationSock() {
  const sock = process.env.MUNDER_AUTOMATION_SOCK;
  if (!sock) {
    throw new Error('MUNDER_AUTOMATION_SOCK is not set');
  }
  return sock;
}

function callAutomation(method, params) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const payload = JSON.stringify({
      id,
      service: 'browser',
      method,
      params: params ?? {}
    }) + '\n';
    const conn = createConnection(automationSock());
    let buf = '';
    const fail = (err) => {
      conn.destroy();
      reject(err);
    };
    conn.setTimeout(35_000, () => fail(new Error('automation socket timeout')));
    conn.on('error', fail);
    conn.on('connect', () => conn.write(payload));
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      conn.end();
      try {
        const res = JSON.parse(buf.slice(0, nl));
        if (!res.ok) {
          reject(new Error(res.error?.message ?? 'browser tool failed'));
          return;
        }
        resolve(res.result);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  };
}

const TOOLS = [
  {
    name: 'browser_tabs',
    description: 'List, focus, open, or close Chrome tabs via the Munder browser extension.',
    method: 'browser_tabs'
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the focused or specified tab to a URL.',
    method: 'browser_navigate'
  },
  {
    name: 'browser_snapshot',
    description: 'Capture an accessibility/interaction snapshot with stable refs for the page.',
    method: 'browser_snapshot'
  },
  {
    name: 'browser_click',
    description: 'Click an element by ref or coordinates.',
    method: 'browser_click'
  },
  {
    name: 'browser_type',
    description: 'Type text into a field (by ref or focused element).',
    method: 'browser_type'
  },
  {
    name: 'browser_press',
    description: 'Press a key or hotkey in the browser.',
    method: 'browser_press'
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a PNG screenshot of the page (optional full-page).',
    method: 'browser_screenshot'
  },
  {
    name: 'browser_evaluate',
    description: 'Run JavaScript in the page context (high privilege).',
    method: 'browser_evaluate'
  }
];

async function main() {
  const server = new McpServer({
    name: 'munder-browser-bridge',
    version: '0.1.0'
  });

  for (const tool of TOOLS) {
    server.registerTool(tool.name, { description: tool.description }, async (args) => {
      const result = await callAutomation(tool.method, args ?? {});
      return textResult(result);
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`browser-bridge MCP fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
