#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = process.env.ROUTER_URL || 'http://localhost:20130';
const DEFAULT_COMBO = process.env.REVIEW_COMBO || 'review-fast';
const MAX_INPUT = 120000;

function getArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readInput() {
  const files = getArg('files');
  const diffPath = getArg('diff');

  if (files && diffPath) throw new Error('use --files or --diff, not both');

  if (diffPath) return fs.readFileSync(path.resolve(diffPath), 'utf8');

  if (files) {
    return files.split(',').map((file) => {
      const requested = file.trim();
      return `### ${requested}\n${fs.readFileSync(path.resolve(requested), 'utf8')}`;
    }).join('\n\n');
  }

  if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8');
  throw new Error('input required: --files path[,path] or --diff file');
}

function prompt(focus) {
  return [
    'You are a senior code-review agent.',
    'Review only supplied code. Do not invent repository context.',
    'Prioritize exploitable security defects, data loss, broken behavior, and production incidents.',
    'Return strict JSON with this shape:',
    '{"summary":"string","blocking":[{"title":"string","file":"string","line":"string","reason":"string","fix":"string"}],"warnings":[...],"nits":[...],"security":["string"]}.',
    'Each finding must be concrete and actionable. Use empty arrays when none exist.',
    `Review focus: ${focus}.`
  ].join(' ');
}

const REVIEW_KEYS = ['summary', 'blocking', 'warnings', 'nits', 'security'];

function parseJson(text) {
  const s = String(text).trim();
  try {
    return JSON.parse(s);
  } catch {
    // fall through to balanced-scan below
  }
  const start = s.search(/[{[]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function findReview(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    return parsed ? findReview(parsed, depth + 1) : null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (REVIEW_KEYS.every((key) => key in value)) {
    return findReview(value.summary, depth + 1) || value;
  }
  for (const child of Object.values(value)) {
    const found = findReview(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseResponse(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('router response has no message content');

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const parsed = parseJson(fenced ? fenced[1] : content);
  if (!parsed) throw new Error('router response is not valid JSON');

  const review = findReview(parsed);
  if (!review) throw new Error('router response missing review schema (summary/blocking/warnings/nits/security)');

  for (const key of ['blocking', 'warnings', 'nits', 'security']) {
    if (!Array.isArray(review[key])) throw new Error(`router response ${key} must be an array`);
  }
  if (typeof review.summary !== 'string') throw new Error('router response summary must be a string');

  return review;
}

function printReview(review, json) {
  if (json) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  console.log(`Summary: ${review.summary || 'No summary'}`);
  for (const section of ['blocking', 'warnings', 'nits']) {
    const findings = Array.isArray(review[section]) ? review[section] : [];
    console.log(`\n${section.toUpperCase()} (${findings.length})`);
    for (const finding of findings) {
      if (typeof finding === 'string') console.log(`- ${finding}`);
      else console.log(`- ${finding.title || 'Finding'}${finding.file ? ` [${finding.file}${finding.line ? `:${finding.line}` : ''}]` : ''}: ${finding.reason || finding.message || ''}${finding.fix ? ` Fix: ${finding.fix}` : ''}`);
    }
  }
  const security = Array.isArray(review.security) ? review.security : [];
  console.log(`\nSECURITY (${security.length})`);
  security.forEach((item) => console.log(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`));
}

function selfCheck() {
  if (getArg('combo', 'review-fast') !== 'review-fast') throw new Error('self-check combo default failed');

  const plain = '{"summary":"ok","blocking":[],"warnings":[],"nits":[],"security":[]}';
  if (parseResponse({ choices: [{ message: { content: plain } }] }).summary !== 'ok') {
    throw new Error('self-check response parsing failed');
  }

  const nested = '{"summary":"{\\"summary\\":\\"inner\\",\\"blocking\\":[],\\"warnings\\":[],\\"nits\\":[],\\"security\\":[]}"}';
  if (parseResponse({ choices: [{ message: { content: nested } }] }).summary !== 'inner') {
    throw new Error('self-check nested response parsing failed');
  }

  const messy = '{"summary":"{\\"summary\\":\\"inner2\\",\\"blocking\\":[{\\"title\\":\\"t\\"}],\\"warnings\\":[],\\"nits\\":[],\\"security\\":[]}\\n\\nSome trailing explanation"}';
  const messyReview = parseResponse({ choices: [{ message: { content: messy } }] });
  if (messyReview.summary !== 'inner2' || messyReview.blocking.length !== 1) {
    throw new Error('self-check trailing-text response parsing failed');
  }

  const prefixProse = 'Here is the review:\n{"summary":"inner3","blocking":[],"warnings":[],"nits":[],"security":[]}\nHope this helps.';
  const prefixReview = parseResponse({ choices: [{ message: { content: prefixProse } }] });
  if (prefixReview.summary !== 'inner3') {
    throw new Error('self-check prefix-prose response parsing failed');
  }

  for (const bad of ['not json', '[]', '{"summary":"s"}']) {
    let threw = false;
    try {
      parseResponse({ choices: [{ message: { content: bad } }] });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`self-check malformed response did not throw: ${bad}`);
  }

  console.log('review-code self-check: ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();

  const combo = getArg('combo', DEFAULT_COMBO);
  const focus = getArg('focus', 'general');
  const baseUrl = getArg('url', DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!combo) throw new Error('--combo cannot be empty');

  const input = readInput().slice(0, MAX_INPUT);
  if (!input.trim()) throw new Error('review input is empty');

  const headers = { 'content-type': 'application/json' };
  if (process.env.ROUTER_API_KEY) headers.authorization = `Bearer ${process.env.ROUTER_API_KEY}`;

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: combo,
      stream: false,
      temperature: 0,
      messages: [
        { role: 'system', content: prompt(focus) },
        { role: 'user', content: input }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`router returned ${response.status}: ${text.slice(0, 500)}`);

  const review = parseResponse(JSON.parse(text));
  printReview(review, process.argv.includes('--json'));
  if (Array.isArray(review.blocking) && review.blocking.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`review-code: ${error.message}`);
  process.exitCode = 2;
});