# Review agent

Run after generated code changes finish:

```cmd
node 9router-automation/review-code.cjs --diff review.diff --combo review-fast --focus general
```

Create diff input from current worktree:

```cmd
git diff --no-ext-diff > review.diff
node 9router-automation/review-code.cjs --diff review.diff --combo review-fast --focus general
del review.diff
```

Review changed files directly:

```cmd
node 9router-automation/review-code.cjs --files src/app/api/foo/route.js,src/lib/bar.js --combo review-fast --focus security
```

Use `review-security` for auth, secrets, permissions, network, or dependency changes. Use `review-consensus` for high-risk changes after configuring that combo in 9router.

Environment:

- `ROUTER_URL`: default `http://localhost:20130`
- `ROUTER_API_KEY`: optional bearer token
- `REVIEW_COMBO`: default `review-fast`

Exit codes:

- `0`: review completed without blocking findings
- `2`: request failure, invalid input, or blocking findings

Agent rule:

1. Finish generated code.
2. Run tests and formatter.
3. Run review command against changed files or diff.
4. Fix blocking findings.
5. Repeat review after fixes.
6. Do not claim completion while review command exits `2`.

Self-check:

```cmd
node 9router-automation/review-code.cjs --self-check