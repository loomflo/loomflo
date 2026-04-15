#!/usr/bin/env node
import { theme } from '../src/theme/index.js';

console.log(theme.heading('loomflo — theme preview'));
console.log();

console.log(theme.line(theme.glyph.check, 'accent', 'daemon running', 'pid 2401, up 3m'));
console.log(theme.line(theme.glyph.check, 'accent', 'project my-todo-app registered', 'proj_a3f2k9c1'));
console.log(theme.line(theme.glyph.arrow, 'muted', 'workflow init', 'node 2/7  ·  12s  ·  $0.14'));
console.log(theme.line(theme.glyph.warn, 'warn', 'retry node 3', 'attempt 1/3'));
console.log(theme.line(theme.glyph.cross, 'err', 'node auth-middleware failed', 'see logs'));
console.log();

console.log(theme.heading('Project settings'));
console.log(theme.kv('provider', 'anthropic-oauth'));
console.log(theme.kv('level', '2'));
console.log(theme.kv('budget', 'unlimited'));
console.log(theme.kv('delay', '1000ms'));
console.log();

console.log(theme.heading('Nodes'));
console.log(
  theme.table(
    ['ID', 'TITLE', 'STATUS', 'DUR'],
    [
      { id: 'spec-01', title: 'Define auth model', status: 'done', dur: '42s' },
      { id: 'impl-01', title: 'auth-middleware', status: 'retry', dur: '2m 14s' },
      { id: 'impl-02', title: 'session-store', status: 'pending', dur: '—' },
    ],
    [
      { header: 'ID', get: (r) => r.id },
      { header: 'TITLE', get: (r) => r.title },
      { header: 'STATUS', get: (r) => r.status },
      { header: 'DUR', get: (r) => r.dur },
    ],
  ),
);

const sp = theme.spinner('validating credentials…');
sp.start();
setTimeout(() => sp.succeed('credentials validated'), 600);
