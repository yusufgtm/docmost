#!/usr/bin/env node
'use strict';

const http = require('http');

const TOKEN = process.argv[2] || process.env.DOCMOST_TOKEN || '';
const BASE_URL = process.argv[3] || 'http://localhost:3000';

let pending = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pending === 0) process.exit(0);
}

function postToMcp(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${BASE_URL}/mcp`);

    const opts = {
      hostname: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function handleMessage(msg) {
  const isNotification = msg.id === undefined;
  pending++;

  postToMcp(msg)
    .then((resp) => {
      if (!isNotification && resp !== null) {
        // unwrap the NestJS TransformHttpResponseInterceptor envelope if present
        const payload = resp?.data ?? resp;
        process.stdout.write(JSON.stringify(payload) + '\n');
      }
    })
    .catch((err) => {
      process.stderr.write(`[docmost-mcp] error: ${err.message}\n`);
      if (!isNotification) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          error: { code: -32603, message: err.message },
        }) + '\n');
      }
    })
    .finally(() => {
      pending--;
      maybeExit();
    });
}

let buf = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      process.stderr.write(`[docmost-mcp] parse error: ${e.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});
