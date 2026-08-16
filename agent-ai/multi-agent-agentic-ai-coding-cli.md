# Multi-Agent Agentic AI Coding with Multiple CLI Agents

You can combine **Claude Code CLI**, **Codex CLI**, **Gemini CLI**, **OpenCode**, **Cline**, **Qwen Code**, **Aider**, **Kilo Code**, **Amp**, **GitHub Copilot CLI**, **Goose**, and other coding CLIs into one multi-agent coding system.

The recommended architecture is to use one **orchestrator** above all of them and give each coding agent its own isolated Git worktree.

---

## Recommended Architecture

```text
                    ┌──────────────────────┐
                    │   MASTER / MANAGER   │
                    │ Node.js orchestrator │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼─────────────────┐
              │                │                 │
              ▼                ▼                 ▼
        Architecture       Implementation       Testing
        Claude Code        Codex CLI            Gemini CLI
        OpenCode           Cline                Qwen Code
              │                │                 │
              └────────────────┼─────────────────┘
                               ▼
                         Code Review
                      Amp / Aider / Kilo
                               │
                               ▼
                         Integration
                      Copilot / Goose
                               │
                               ▼
                       Final test + merge
```

The most important rule:

> **Do not let many coding agents edit the same Git checkout at the same time.**

Instead, give each agent its own Git worktree and branch.

---

# 1. Repository Layout

Example:

```text
myproject/
│
├── main/
│
└── .agents/
    ├── claude/
    ├── codex/
    ├── gemini/
    ├── qwen/
    ├── cline/
    ├── aider/
    ├── opencode/
    ├── kilo/
    ├── amp/
    └── copilot/
```

Each agent works independently.

---

# 2. Create Git Worktrees

Suppose your project is:

```powershell
D:\projects\myapp
```

Run:

```powershell
git checkout main
git pull

mkdir .agents

git worktree add .agents/claude -b agent/claude
git worktree add .agents/codex -b agent/codex
git worktree add .agents/gemini -b agent/gemini
git worktree add .agents/qwen -b agent/qwen
git worktree add .agents/cline -b agent/cline
git worktree add .agents/aider -b agent/aider
git worktree add .agents/opencode -b agent/opencode
git worktree add .agents/kilo -b agent/kilo
git worktree add .agents/amp -b agent/amp
git worktree add .agents/copilot -b agent/copilot
```

Your branches become:

```text
main
 │
 ├── agent/claude
 ├── agent/codex
 ├── agent/gemini
 ├── agent/qwen
 ├── agent/cline
 ├── agent/aider
 ├── agent/opencode
 ├── agent/kilo
 ├── agent/amp
 └── agent/copilot
```

---

# 3. Run Each CLI in Headless / Non-Interactive Mode

The orchestrator must be able to launch agents from scripts.

## Claude Code

```powershell
claude -p "Implement the authentication service."
```

## Codex CLI

```powershell
codex exec "Implement the authentication service and run the tests."
```

## Gemini CLI

```powershell
gemini -p "Implement unit tests for the authentication service."
```

## Qwen Code

```powershell
qwen -p "Review the authentication implementation and find bugs."
```

## OpenCode

```powershell
opencode run "Implement the API endpoints."
```

With a specific model:

```powershell
opencode run --model google/gemini-3-pro "Implement the API endpoints."
```

## Cline

```powershell
cline --json "Implement the React login page."
```

Autonomous mode:

```powershell
cline --yolo "Implement the React login page and run tests."
```

## Aider

```powershell
aider --yes --message "Refactor the authentication module."
```

## Kilo Code

```powershell
kilo run --auto "Implement feature X and run tests."
```

## Amp

```powershell
amp -x "Review this repository for concurrency problems."
```

## GitHub Copilot CLI

```powershell
copilot -p "Review the current implementation."
```

---

# 4. Give Different Agents Different Jobs

Do not tell every agent:

```text
Build my application.
```

Instead split responsibilities:

```text
MASTER AGENT

Task #1
Claude
→ architecture

Task #2
Gemini
→ research existing code

Task #3
Codex
→ backend implementation

Task #4
Cline
→ frontend implementation

Task #5
Qwen
→ tests

Task #6
Aider
→ small refactoring

Task #7
Kilo
→ integration fixes

Task #8
Amp
→ code review

Task #9
Copilot
→ GitHub / CI review

Task #10
Goose
→ tooling / integration

Task #11
OpenCode
→ second independent review
```

---

# 5. Use Competing Agents for Difficult Problems

Multiple agents can independently solve the same problem.

```text
                 FEATURE
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       Claude     Codex     Gemini
          │         │         │
       Solution A Solution B Solution C
          │         │         │
          └─────────┼─────────┘
                    ▼
                  Judge
                   Amp
                    │
                    ▼
              Best solution
```

Example:

```text
Claude:
Find the cause of this Node.js memory leak.

Codex:
Independently investigate this Node.js memory leak.

Gemini:
Independently investigate this Node.js memory leak.
```

Then a reviewer agent:

```text
Here are three diagnoses.

Compare them against the code and determine which explanation
is supported by evidence.

Do not assume the majority is correct.
```

---

# 6. Node.js Orchestrator

Recommended structure:

```text
agent-orchestrator/
│
├── orchestrator.js
│
├── agents/
│   ├── claude.js
│   ├── codex.js
│   ├── gemini.js
│   ├── qwen.js
│   ├── cline.js
│   ├── aider.js
│   ├── opencode.js
│   ├── kilo.js
│   ├── amp.js
│   └── copilot.js
│
├── prompts/
│   ├── architect.md
│   ├── developer.md
│   ├── tester.md
│   ├── reviewer.md
│   └── security.md
│
└── workspace/
    ├── tasks.json
    ├── results/
    └── logs/
```

Basic process runner:

```javascript
import { spawn } from "node:child_process";

function runAgent(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", data => {
      stdout += data;
      process.stdout.write(data);
    });

    child.stderr.on("data", data => {
      stderr += data;
      process.stderr.write(data);
    });

    child.on("close", code => {
      resolve({
        code,
        stdout,
        stderr
      });
    });

    child.on("error", reject);
  });
}
```

Define CLI adapters:

```javascript
const agents = {
  claude: (prompt, cwd) =>
    runAgent("claude", ["-p", prompt], cwd),

  codex: (prompt, cwd) =>
    runAgent("codex", ["exec", prompt], cwd),

  gemini: (prompt, cwd) =>
    runAgent("gemini", ["-p", prompt], cwd),

  qwen: (prompt, cwd) =>
    runAgent("qwen", ["-p", prompt], cwd),

  cline: (prompt, cwd) =>
    runAgent("cline", ["--json", prompt], cwd),

  opencode: (prompt, cwd) =>
    runAgent("opencode", ["run", prompt], cwd),

  aider: (prompt, cwd) =>
    runAgent(
      "aider",
      ["--yes", "--message", prompt],
      cwd
    ),

  kilo: (prompt, cwd) =>
    runAgent(
      "kilo",
      ["run", "--auto", prompt],
      cwd
    ),

  amp: (prompt, cwd) =>
    runAgent("amp", ["-x", prompt], cwd),

  copilot: (prompt, cwd) =>
    runAgent("copilot", ["-p", prompt], cwd)
};
```

This creates a vendor-independent interface:

```javascript
agents.claude(prompt)
agents.codex(prompt)
agents.gemini(prompt)
agents.qwen(prompt)
```

---

# 7. Run Agents in Parallel

```javascript
const results = await Promise.all([
  agents.claude(
    "Analyze backend architecture. Do not modify files.",
    ".agents/claude"
  ),

  agents.gemini(
    "Analyze frontend architecture. Do not modify files.",
    ".agents/gemini"
  ),

  agents.qwen(
    "Analyze test coverage. Do not modify files.",
    ".agents/qwen"
  ),

  agents.codex(
    "Analyze security risks. Do not modify files.",
    ".agents/codex"
  )
]);
```

Architecture:

```text
Node orchestrator
       │
       ├──── Claude
       ├──── Codex
       ├──── Gemini
       └──── Qwen
```

---

# 8. Parallel Implementation

```javascript
await Promise.all([
  agents.codex(
    `
    Implement backend task #1.

    Requirements are in ../../tasks/backend.md.

    Run tests.
    Commit your changes when complete.
    `,
    ".agents/codex"
  ),

  agents.cline(
    `
    Implement frontend task #2.

    Requirements are in ../../tasks/frontend.md.

    Run tests.
    Commit your changes when complete.
    `,
    ".agents/cline"
  )
]);
```

Because they use separate worktrees, Codex and Cline can safely modify code at the same time.

---

# 9. Cross-Agent Review

A useful pipeline:

```text
Codex
  ↓
implements backend
  ↓
commit
  ↓
Claude
  ↓
reviews Codex commit
  ↓
Qwen
  ↓
creates additional tests
  ↓
Amp
  ↓
final review
```

Independent review is valuable because different models have different failure modes.

Avoid:

```text
Codex writes code
Codex reviews Codex
Codex says Codex is correct
```

---

# 10. Shared Task Protocol

Create:

```text
.agent/tasks/
.agent/results/
```

Example task:

```json
{
  "id": "AUTH-001",
  "role": "backend",
  "goal": "Implement JWT authentication",
  "requirements": [
    "Access token expires after 15 minutes",
    "Refresh tokens are supported",
    "Add unit tests"
  ],
  "allowed_paths": [
    "src/auth",
    "tests/auth"
  ],
  "validation": [
    "npm test",
    "npm run lint"
  ]
}
```

Require agents to return structured results:

```json
{
  "task": "AUTH-001",
  "status": "completed",
  "branch": "agent/codex",
  "commit": "abc123",
  "tests": {
    "npm test": "passed",
    "npm run lint": "passed"
  },
  "notes": [
    "Added JWT validation",
    "Added refresh-token rotation"
  ]
}
```

Structured output is easier for another agent or script to understand than random prose.

---

# 11. Add an Agent Manager

Give a manager agent a list of workers:

```text
Available workers:

claude
  strengths: architecture, reasoning, code review

codex
  strengths: implementation, debugging

gemini
  strengths: large codebase analysis, research

qwen
  strengths: cheap testing, analysis

cline
  strengths: autonomous implementation

aider
  strengths: focused code edits

amp
  strengths: review

kilo
  strengths: autonomous tasks
```

Then ask the manager:

```text
Goal:
Implement OAuth authentication.

Repository:
...

Available agents:
...

Break this project into tasks.

For each task return:

{
  agent,
  task,
  depends_on,
  writable_paths,
  validation
}
```

Possible execution graph:

```text
              MANAGER
                 │
        ┌────────┴─────────┐
        ▼                  ▼
   Gemini analysis    Claude architecture
        │                  │
        └────────┬─────────┘
                 ▼
            implementation
            /            \
         Codex           Cline
        backend         frontend
            \            /
             └─────┬────┘
                   ▼
                  Qwen
                  tests
                   │
                   ▼
                  Amp
                 review
                   │
                   ▼
                Codex
                  fix
                   │
                   ▼
             npm test
                   │
                   ▼
                 merge
```

---

# 12. Recommended Agent Pool

Do not run every agent on every task.

A better setup:

```text
                  MASTER
                 OpenCode
                    │
       ┌────────────┼─────────────┐
       │            │             │
    Claude        Codex         Gemini
  Architect      Developer      Research
       │            │             │
       └────────────┼─────────────┘
                    │
                 Qwen
                 Tests
                    │
                   Amp
                 Review
```

Keep these available as specialist workers:

```text
Cline
Aider
Kilo
Copilot
Goose
```

The goal is not:

```text
Use 12 agents.
```

The goal is:

> Build a pool of many agents from which a manager dynamically chooses the best 2–5 agents for each job.

---

# 13. MCP-Based Architecture

A more advanced architecture is to expose all CLI agents through an MCP server.

```text
                    Claude/OpenCode
                    MASTER AGENT
                         │
                         │ MCP
                         ▼
                ┌─────────────────┐
                │ Agent MCP Server│
                └────────┬────────┘
                         │
     ┌───────────┬───────┼────────┬─────────┐
     ▼           ▼       ▼        ▼         ▼
 run_codex   run_gemini run_qwen run_cline run_aider
     │           │       │        │         │
     ▼           ▼       ▼        ▼         ▼
 worktree    worktree worktree worktree  worktree
```

The MCP server can expose tools such as:

```text
run_codex(task)
run_claude(task)
run_gemini(task)
run_qwen(task)
run_cline(task)
get_agent_status(id)
get_agent_result(id)
merge_agent_branch(id)
```

This gives the master agent a unified way to control all coding agents.

---

# Recommended Stack

For a serious local multi-agent coding platform, use:

```text
Node.js
+
Git worktrees
+
CLI adapters
+
Structured task/result JSON
+
Parallel execution
+
Independent review
+
MCP server
```

This gives you one master agent controlling a pool of coding agents without locking your system to a single model provider.
