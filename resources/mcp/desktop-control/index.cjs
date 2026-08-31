#!/usr/bin/env node
'use strict';

/**
 * stdio MCP server — forwards desktop_* tools to the Electron automation socket.
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
  // Dev repo: resources/mcp/desktop-control → project root
  roots.push(path.join(__dirname, '..', '..', '..'));
  // Packaged extraResources: .../Resources/mcp/desktop-control → app.asar.unpacked
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
    'desktop-control MCP: cannot find @modelcontextprotocol/sdk; set MUNDER_APP_ROOT\n'
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
      service: 'desktop',
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
          reject(new Error(res.error?.message ?? 'desktop tool failed'));
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
    name: 'desktop_screenshot',
    description: 'Capture a PNG screenshot of the primary display (base64).',
    method: 'desktop_screenshot'
  },
  {
    name: 'desktop_click',
    description: 'Click at screen coordinates (x, y).',
    method: 'desktop_click'
  },
  {
    name: 'desktop_move',
    description: 'Move the mouse pointer to screen coordinates (x, y).',
    method: 'desktop_move'
  },
  {
    name: 'desktop_type',
    description: 'Type text via the system keyboard.',
    method: 'desktop_type'
  },
  {
    name: 'desktop_hotkey',
    description: 'Press a keyboard shortcut (e.g. keys: ["cmd", "c"]).',
    method: 'desktop_hotkey'
  },
  {
    name: 'desktop_screen_size',
    description: 'Return primary display width and height for coordinate planning.',
    method: 'desktop_screen_size'
  }
];

async function main() {
  const server = new McpServer({
    name: 'munder-desktop-control',
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
  process.stderr.write(`desktop-control MCP fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
