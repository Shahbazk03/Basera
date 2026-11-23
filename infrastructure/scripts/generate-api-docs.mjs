#!/usr/bin/env node
// Generates docs/api/endpoints.md from the running API's OpenAPI document.
//   node infrastructure/scripts/generate-api-docs.mjs [http://localhost:4000]
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const res = await fetch(`${base}/api/docs/openapi.json`);
if (!res.ok) throw new Error(`Could not load OpenAPI document: ${res.status}`);
const doc = await res.json();

const byTag = new Map();
for (const [route, ops] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const tag = op.tags?.[0] ?? 'Other';
    const secured = (op.security ?? []).length > 0;
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push({ method: method.toUpperCase(), route, secured });
  }
}

const lines = [
  '# API endpoint index',
  '',
  `Generated from the live OpenAPI document (${doc.info?.title ?? 'API'} ${doc.info?.version ?? ''}) — do not edit by hand.`,
  'Run `node infrastructure/scripts/generate-api-docs.mjs` after changing controllers. Interactive documentation: `/api/docs`.',
  '',
  'Unless marked **public**, every endpoint requires an authenticated session and the permissions documented in the controller.',
  '',
];
const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
for (const tag of [...byTag.keys()].sort()) {
  lines.push(`## ${tag}`, '', '| Method | Path | Access |', '| --- | --- | --- |');
  for (const op of byTag.get(tag).sort((a, b) => a.route.localeCompare(b.route) || order.indexOf(a.method) - order.indexOf(b.method))) {
    const pub = op.route.includes('/public/') || /\/(health|auth\/(login|register|refresh|logout|forgot-password|reset-password|verify-email))/.test(op.route) || /\/files\/\{id\}\/(url|download)/.test(op.route);
    lines.push(`| ${op.method} | \`${op.route}\` | ${pub ? 'public' : 'authenticated'} |`);
  }
  lines.push('');
}
const out = path.resolve(import.meta.dirname, '../../docs/api/endpoints.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${out} (${[...byTag.values()].reduce((n, l) => n + l.length, 0)} operations)`);
