#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const agentDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(agentDir, '../..');
const runDir = path.resolve(process.env.AGENT_RUN_DIR || 'agent/runs/review');
const diffPath = path.join(runDir, 'review.diff');

await mkdir(runDir, { recursive: true });
const { stdout: diff } = await execFileAsync('git', ['diff', '--no-ext-diff'], {
  cwd: projectDir,
  maxBuffer: 2 * 1024 * 1024,
});
await writeFile(diffPath, diff, 'utf8');

if (!diff.trim()) {
  process.stdout.write('Code review skipped: empty git diff.\n');
  process.exit(0);
}

const env = {
  ...process.env,
  ROUTER_URL: process.env.N9ROUTER_BASE_URL
    ? process.env.N9ROUTER_BASE_URL.replace(/\/v1\/?$/u, '')
    : process.env.ROUTER_URL,
  ROUTER_API_KEY: process.env.N9ROUTER_API_KEY || process.env.ROUTER_API_KEY,
};

const { stdout, stderr } = await execFileAsync(
  process.execPath,
  [
    path.join(agentDir, 'review-code.cjs'),
    '--diff',
    diffPath,
    '--combo',
    process.env.REVIEW_COMBO || 'review-fast',
  ],
  { cwd: projectDir, env, maxBuffer: 2 * 1024 * 1024 },
);

process.stdout.write(stdout);
process.stderr.write(stderr);