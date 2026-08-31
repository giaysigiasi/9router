---
name: 9router-deploy
description: Deploy 9Router to UAT server (p106-platform) and push to all remotes. Use when the user wants to deploy, push to gitlab, push to p106, or update the UAT 9router instance.
---

# 9Router Deployment Playbook

## Remotes

| Remote | URL | Purpose |
|---|---|---|
| `origin` / `improvement` | `https://github.com/giaysigiasi/9router.git` | GitHub main |
| `gitlab` | `http://192.168.1.33:8080/lab/9router.git` | Internal GitLab |
| `p106` | `ssh://davidtran@p106-platform/opt/9router` | UAT server |

## UAT Topology (p106-platform)

| Container | Port | Branch | Image | Purpose |
|---|---|---|---|---|
| `9router-source` | 20130 | `david-dev` (source build) | `9router:local` | Main dev/UAT instance |
| `9router-master` | 20131 | `master` (pre-built) | `9router-master:local` | Stable fallback |
| `headroom` | 8787 | — | `ghcr.io/chopratejas/headroom:latest` | Proxy sidecar |

Both 9router containers share the `9router-data` Docker volume (`/app/data`).
Rebuild does NOT touch the volume — data (DB, credentials, combos) is safe.

## Zero-Downtime Deploy Steps

### 1. Push to all remotes

```bash
git push origin david-dev
git push gitlab david-dev
git push p106 david-dev
```

### 2. Pull on UAT server

```bash
ssh p106-platform 'cd /opt/9router && git fetch origin && git reset --hard origin/david-dev'
```

### 3. Rebuild only 9router-source (leave master running)

```bash
ssh p106-platform 'cd /opt/9router && docker compose build 9router'
ssh p106-platform 'cd /opt/9router && docker compose up -d --force-recreate 9router'
```

This recreates only `9router-source` (port 20130). `9router-master` (port 20131) stays untouched.

### 4. Verify

```bash
# New code live?
ssh p106-platform 'curl -s http://localhost:20130/api/health'

# Master still up?
ssh p106-platform 'curl -s http://localhost:20131/api/health'

# Both containers running?
ssh p106-platform 'docker ps --filter name=9router'
```

### 5. Check logs for errors

```bash
ssh p106-platform 'docker logs 9router-source --tail 20'
```

## Rollback

If the new code breaks 9router-source:

```bash
ssh p106-platform 'cd /opt/9router && git revert HEAD && docker compose build 9router && docker compose up -d --force-recreate 9router'
```

Or switch traffic to master (port 20131) while debugging.

## Safety Rules

- **Never rebuild both containers at the same time** — always one at a time
- **Never `docker compose down`** without specifying the service — that kills headroom too
- **Always verify master is still up** after rebuilding source
- **Data volume is shared** — both containers read/write the same `9router-data`
- **Branch**: `david-dev` is the active development branch for 9router-source
