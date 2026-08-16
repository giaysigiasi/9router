const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BASE_URL, API_KEY, AGENT_COMBO } = require('./config');

// adapters: run one agent CLI against 9Router. Each agent gets its combo via env.
function runAgent(agent, promptFile, cwd) {
  const combo = AGENT_COMBO[agent];
  if (!combo) throw new Error('no combo for ' + agent);
  const prompt = fs.readFileSync(promptFile, 'utf8');
  const env = { ...process.env };
  const args = [];
  if (agent === 'claude') {
    env.ANTHROPIC_BASE_URL = BASE_URL;
    env.ANTHROPIC_API_KEY = API_KEY;
    args.push('-p', prompt, '--model', combo);
  } else if (agent === 'codex') {
    env.OPENAI_BASE_URL = BASE_URL;
    env.OPENAI_API_KEY = API_KEY;
    args.push('-p', prompt, '-m', combo);
  } else if (agent === 'gemini') {
    env.GEMINI_API_KEY = API_KEY;
    args.push('-p', prompt, '--model', combo);
  } else {
    throw new Error('unknown agent ' + agent);
  }
  const r = spawnSync(agent, args, { cwd, env, encoding: 'utf8', maxBuffer: 1e8 });
  return { agent, combo, status: r.status, stdout: (r.stdout || '').slice(-2000), stderr: (r.stderr || '').slice(-1000) };
}

// task-protocol: write per-agent prompt files from a task spec.
function writePrompts(task, dir) {
  const base = `Repo: ${task.repo}\nBranch: ${task.branch}\nGoal: ${task.goal}\n`;
  const files = {
    'claude-prompt.md': base + 'ROLE: architect. READ-ONLY. Produce design + file plan. No edits.\n',
    'codex-prompt.md': base + 'ROLE: backend implementer. Implement per architect plan. Commit to branch.\n',
    'gemini-prompt.md': base + 'ROLE: research. READ-ONLY. Find prior art / risks. No edits.\n',
  };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  return files;
}

// orchestrator: phase pipeline. dryRun skips actual CLI spawn (for pilot).
function run(task, opts = {}) {
  const dir = opts.workDir || path.join(__dirname, 'runs', Date.now().toString());
  fs.mkdirSync(dir, { recursive: true });
  writePrompts(task, dir);
  const out = {};
  for (const agent of Object.keys(AGENT_COMBO)) {
    if (opts.dryRun) { out[agent] = { agent, combo: AGENT_COMBO[agent], dry: true }; continue; }
    if (agent === 'codex' && out.claude) {
      fs.appendFileSync(path.join(dir, 'codex-prompt.md'), '\n\nARCHITECT DESIGN:\n' + out.claude.stdout);
    }
    out[agent] = runAgent(agent, path.join(dir, agent + '-prompt.md'), task.cwd || process.cwd());
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 2));
  return { dir, out };
}

module.exports = { run, runAgent, writePrompts, AGENT_COMBO };
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const task = {
    repo: get('--repo') || 'crazy-games-demo',
    branch: get('--branch') || 'feat/orchestrator-pilot',
    goal: get('--goal') || 'pilot',
    cwd: get('--cwd') || process.cwd(),
  };
  const real = args.includes('--real');
  console.log(JSON.stringify(run(task, real ? {} : { dryRun: true }), null, 2));
}
