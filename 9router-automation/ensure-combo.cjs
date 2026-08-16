#!/usr/bin/env node
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const COMBO = 'review-fast';
const MODELS = [
  'cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  'cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast',
  'oc/deepseek-v4-flash-free',
];

function getArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const dbPath = getArg('db', '/app/data/db/data.sqlite');
if (!path.isAbsolute(dbPath)) throw new Error('--db must be an absolute path');

const db = new Database(dbPath);

const existing = db
  .prepare('SELECT name, models FROM combos WHERE name = ?')
  .get(COMBO);

let status;
if (existing) {
  status = 'exists';
  console.log(JSON.stringify({ combo: COMBO, status, models: JSON.parse(existing.models || '[]') }));
} else {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(require('crypto').randomUUID(), COMBO, undefined, JSON.stringify(MODELS), now, now);
  status = 'created';
  console.log(JSON.stringify({ combo: COMBO, status, models: MODELS }));
}

db.close();
process.exit(0);