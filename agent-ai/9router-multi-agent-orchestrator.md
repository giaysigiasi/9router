# 9Router Multi-Agent Coding Orchestrator Strategy

**Status:** Design  
**Scope:** Use multiple coding CLI agents through one local 9Router instance.

## 1. Core Model

Use two layers:

```text
Agent layer:  Node.js orchestrator + CLI agents + Git worktrees
Model layer: 9Router + combo pools + provider fallback
```

9Router provides one OpenAI-compatible endpoint:

```text
http://localhost:20128/v1
```

The orchestrator assigns each agent a 9Router combo through the `model` request field or CLI configuration.

Do not allow multiple agents to edit one checkout simultaneously. Give each implementation agent its own Git worktree and branch.

## 2. Strategy Selection

| Multi-agent feature | 9Router fit | Decision |
|---|---|---|
| Isolated Git worktrees | Prevents concurrent file conflicts | Use |
| Node.js process orchestrator | Coordinates CLI agents | Use |
| Structured task/result JSON | Makes routing and validation machine-readable | Use |
| Dynamic agent pool | Selects 2–5 agents per task | Use |
| Competing agents solving same task | Duplicates quota usage | Usually skip |
| MCP wrapper around every CLI | Adds another control layer over one shared API | Defer |

9Router already handles provider interleave and ordered fallback. Multi-agent orchestration should handle task ownership, worktrees, dependencies, validation, and merge order.

## 3. Recommended Agent Pool

Do not run all available CLIs for every task. Use a small role-based pool.

| Agent | Role | 9Router combo | File access |
|---|---|---|---|
| Claude Code | Architecture and design review | `1-reasoning` | Read-only, unless assigned implementation |
| Codex CLI | Backend implementation and debugging | `1-coding-max` | Backend worktree |
| Cline | Frontend and autonomous implementation | `2-coding-max` | Frontend worktree |
| Gemini CLI | Repository research and impact analysis | `2-reasoning` | Read-only |
| Qwen Code | Test creation and test review | `3-coding-max` | Test worktree |
| Amp or Aider | Focused review and small fixes | `3-reasoning` | Review worktree |

Use different combo families for concurrent implementation agents. Example:

```text
Codex: 1-coding-max
Cline: 2-coding-max
```

This preserves 9Router's provider-diversified heads instead of concentrating concurrent requests on one combo.

## 4. Role Separation

Use two model roles:

```text
*-reasoning   planning, research, architecture, review
*-coding-max  edits, implementation, test fixes
```

Example workflow:

```text
Claude   → architecture
Gemini   → repository research
Codex    → backend implementation
Cline    → frontend implementation
Qwen     → tests
Amp      → independent review
Codex    → review fixes
```

Reasoning agents should receive explicit read-only instructions when they must not change files:

```text
Analyze the assigned scope. Do not modify files.
Return findings, risks, dependencies, and validation steps.
```

Implementation agents must have explicit writable paths and validation commands.

## 5. Git Worktree Layout

For project `projects/9router`:

```text
projects/9router/
.agents/
├── architect/
├── backend/
├── frontend/
├── tests/
└── reviewer/
```

Create worktrees from the project repository:

```powershell
cd D:\R&D lab\ai-setup-books\projects\9router

git checkout main
git pull

mkdir .agents

git worktree add .agents\architect -b agent/architect
git worktree add .agents\backend -b agent/backend
git worktree add .agents\frontend -b agent/frontend
git worktree add .agents\tests -b agent/tests
git worktree add .agents\reviewer -b agent/reviewer
```

Use one branch per worktree. Never point two write-enabled agents at the same worktree.

Before assigning work:

```powershell
git worktree list
git status --short
```

After completion, each write-enabled agent must commit:

```powershell
git add --all
git commit -m "agent: complete assigned task"
```

Merge only after validation:

```powershell
git checkout main
git merge --no-ff agent/backend
git merge --no-ff agent/frontend
git merge --no-ff agent/tests
```

## 6. 9Router Environment

Use one local endpoint and select combo per task:

```text
N9ROUTER_BASE_URL=http://localhost:20128/v1
N9ROUTER_API_KEY=9r-local
N9ROUTER_COMBO=1-coding-max
```

The exact API key must match local 9Router configuration. Do not commit secrets.

OpenAI-compatible clients normally require:

```text
Base URL: http://localhost:20128/v1
API key:  9r-local
Model:    1-coding-max
```

Smoke-test a combo before starting agents:

```powershell
curl http://127.0.0.1:20128/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer 9r-local" `
  -d '{"model":"1-reasoning","messages":[{"role":"user","content":"reply OK only"}],"max_tokens":5}'
```

Use current combo names from the rebuild and verification reports. Do not assume legacy names such as `free-coding-max` remain active.

## 7. CLI Adapter Contract

The orchestrator needs one adapter contract regardless of vendor CLI:

```javascript
runAgent({
  agent,
  prompt,
  cwd,
  combo,
  timeoutMs
}) -> {
  code,
  stdout,
  stderr,
  durationMs
}
```

Each adapter must:

1. Set working directory to assigned Git worktree.
2. Pass the task prompt.
3. Set the 9Router base URL and API key.
4. Select assigned combo.
5. Capture stdout and stderr.
6. Enforce timeout.
7. Return non-zero status on process failure.
8. Preserve logs for later review.

Do not assume every CLI supports identical headless flags. Verify each installed CLI's current help output before adding its adapter.

## 8. Task Protocol

Store tasks as JSON:

```json
{
  "id": "AUTH-001",
  "agent": "codex",
  "role": "backend",
  "goal": "Implement JWT authentication",
  "combo": "1-coding-max",
  "worktree": ".agents/backend",
  "allowed_paths": [
    "src/auth",
    "tests/auth"
  ],
  "depends_on": [],
  "validation": [
    "npm test",
    "npm run lint"
  ],
  "must_commit": true
}
```

Required task rules:

- `id` must be unique.
- `worktree` must map to one branch.
- `allowed_paths` must be explicit for write tasks.
- `depends_on` must complete before execution.
- `validation` must run in same worktree.
- `must_commit` must be true for implementation tasks.

Store results as JSON:

```json
{
  "task": "AUTH-001",
  "agent": "codex",
  "status": "completed",
  "branch": "agent/backend",
  "commit": "abc123",
  "tests": {
    "npm test": "passed",
    "npm run lint": "passed"
  },
  "changed_paths": [
    "src/auth",
    "tests/auth"
  ],
  "notes": [
    "Added JWT validation",
    "Added refresh-token rotation"
  ]
}
```

Allowed statuses:

```text
completed
failed
blocked
cancelled
```

A result is not mergeable when status is `failed`, `blocked`, or `commit` is missing.

## 9. Execution Rules

Use dependency-aware execution:

```text
Phase 1: architecture + research, read-only, parallel
Phase 2: backend + frontend implementation, separate worktrees
Phase 3: tests, after implementation commits
Phase 4: review, against committed branches
Phase 5: fixes, one assigned worktree
Phase 6: final validation and merge
```

Quota-safe concurrency:

- Run at most 2–3 agents concurrently.
- Parallelize read-only research and review.
- Do not run two write agents against overlapping paths.
- Serialize agents that modify the same subsystem.
- Stop dependent tasks after an upstream task fails.
- Retry only transient failures, not tool or validation failures.
- Keep prompts short enough to avoid wasting context and quota.

9Router fallback handles provider failure inside one request. It does not replace task-level retry, worktree isolation, or merge control.

## 10. Recommended Pipeline

```text
Claude / Gemini
  architecture and repository analysis
          │
          ▼
Codex
  backend implementation in agent/backend
          │
          ▼
Cline
  frontend implementation in agent/frontend
          │
          ▼
Qwen
  tests in agent/tests
          │
          ▼
Amp / Aider
  independent review
          │
          ▼
Codex
  fixes review findings
          │
          ▼
Final tests
          │
          ▼
Merge approved commits
```

For `projects/9router`, prioritize automation and verification work:

```text
Research:
  inspect combo schema, rebuild scripts, verification scripts

Implementation:
  one agent for orchestration docs or scripts
  one agent for verification/test changes

Review:
  inspect API assumptions, quota behavior, and rollback safety
```

Avoid assigning multiple agents to modify `9router-automation/rebuild-verified-free-combos.cjs` at once.

## 11. What Not to Do

Do not:

- Run every CLI on every request.
- Let agents share one writable checkout.
- Treat exposed account routes as free routes.
- replace current combo names with old `free-*` names without verification.
- place unverified or quota-limited models at combo heads.
- run competing same-task agents by default.
- merge without test and worktree status checks.
- commit API keys or provider credentials.
- let review agents silently modify production branches.

## 12. Verification Checklist

Before execution:

```text
[ ] 9Router is reachable
[ ] combo exists and is verified
[ ] worktree is clean
[ ] branch is correct
[ ] writable paths are assigned
[ ] validation commands are known
```

After each task:

```text
[ ] process exit code is zero
[ ] result JSON exists
[ ] changed paths stay within allowed paths
[ ] validation passes
[ ] commit exists
[ ] worktree is clean
```

Before merge:

```text
[ ] all dependencies completed
[ ] review completed independently
[ ] no unresolved conflicts
[ ] final tests pass on merge target
[ ] rollback commit or backup is known
```

Suggested smoke sequence:

```powershell
curl http://127.0.0.1:20128/health

# Then test the exact combo assigned to each role.
```

## 13. Final Recommendation

Use:

```text
9Router
+ 2–5 role-selected CLI agents
+ isolated Git worktrees
+ reasoning/coding-max role split
+ structured task/result JSON
+ dependency-aware execution
+ independent review
+ final test before merge
```

Start without an MCP server. Add MCP only when a master agent must dynamically discover, start, stop, inspect, or merge workers through tool calls. Until then, a small Node.js orchestrator is simpler and easier to verify.