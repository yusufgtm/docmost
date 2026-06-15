#!/usr/bin/env node
'use strict';

const http = require('http');

// const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTllYzI0Ny1hNzg0LTc2NjItODBiZS0yMDljOTQ5ZjBiMmUiLCJhcGlLZXlJZCI6IjAxOWVjMjVkLWUxZDItN2FhYy1hYWM4LWU4OTk1MzE2OWJhYyIsIndvcmtzcGFjZUlkIjoiMDE5ZWMyNDctYTc4YS03NTJmLWE2OGYtMTI4ODNkMDgyZjYxIiwidHlwZSI6ImFwaV9rZXkiLCJpYXQiOjE3ODEzNzczOTMsImV4cCI6MTc4OTE1MzM5MywiaXNzIjoiRG9jbW9zdCJ9.GfBkETtguF_bWhLwpuqHMHRJg9Wvz-ajHYrVQs2YY10";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTllYzc0MS02NDljLTdjOGItYjgwZS1mOTQxNzA2MGUxMGIiLCJhcGlLZXlJZCI6IjAxOWVjNzQyLTUyNDctN2FhYy04N2Q4LTYyOGZiZGY1YjgyOSIsIndvcmtzcGFjZUlkIjoiMDE5ZWMyNDctYTc4YS03NTJmLWE2OGYtMTI4ODNkMDgyZjYxIiwidHlwZSI6ImFwaV9rZXkiLCJpYXQiOjE3ODE0NTk0NzIsImV4cCI6MTc4OTIzNTQ3MiwiaXNzIjoiRG9jbW9zdCJ9.s3vnvSi4sSe7Dbu9m4s13je-f70VaIjrSj235c-E5n8";
const BASE_URL = process.argv[2] || 'http://localhost:3001';

function postToMcp(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${BASE_URL}/mcp`);
    const opts = {
      hostname: url.hostname,
      port: parseInt(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${TOKEN}`,
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

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const isNotification = msg.id === undefined;
      postToMcp(msg)
        .then((resp) => {
          if (!isNotification && resp !== null) {
            const payload = resp?.data ?? resp;
            process.stdout.write(JSON.stringify(payload) + '\n');
          }
        })
        .catch((err) => {
          if (!isNotification) {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0', id: msg.id ?? null,
              error: { code: -32603, message: err.message },
            }) + '\n');
          }
        });
    } catch(e) {}
  }
});
