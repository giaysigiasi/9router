---
name: 9router-deploy
description: Deploy 9Router to UAT server (p106-platform) with zero-downtime and push to GitHub/GitLab. Use when the user wants to deploy, push to gitlab, or update the UAT 9router instance.
---

# 9Router Deployment Playbook

## Remotes

| Remote | URL | Purpose |
|---|---|---|
| `origin` / `improvement` | `https://github.com/giaysigiasi/9router.git` | GitHub main |
| `gitlab` | `http://192.168.1.33:8080/lab/9router.git` | Internal GitLab (hosted **on p106 itself**) |
| `p106` | `ssh://davidtran@p106-platform/opt/9router` | UAT server git repo |

> ⚠️ **`git push p106 david-dev` is REJECTED** — `/opt/9router` on the UAT box is a
> non-bare repo with `david-dev` checked out, so Git refuses to push to the checked-out
> branch. The deploy does **not** depend on this push: the UAT box does `git fetch origin`
> (its `origin` = GitHub), so the code reaches UAT via the **GitHub** push. Omit the
> `git push p106` line (or expect it to fail harmlessly).

## UAT Topology (p106-platform)

| Container | Port | Branch | Image | Purpose |
|---|---|---|---|---|
| `9router-source` | 20130 | `david-dev` (source build) | `9router:local` | Main dev/UAT instance |
| `9router-master` | 20131 | `master` (pre-built) | `9router-master:local` | Stable fallback |
| `headroom` | 8787 | — | `ghcr.io/chopratejas/headroom:latest` | Proxy sidecar |

Both 9router containers share the `9router-data` Docker volume (`/app/data`).
Rebuild does NOT touch the volume — data (DB, credentials, combos) is safe.

## Zero-Downtime Deploy Steps

**Hard rule:** `9router-master` (20131) stays up the entire time as the live fallback.
We only stop/recreate `9router-source` (20130). The recreate has a brief gap that master
covers. The deploy is "zero-downtime" only if master is healthy **and** the new source
container actually comes back `Up` (a `Created`-but-not-`Up` container = UAT is down).

### 1. Push to remotes

```bash
git push origin david-dev
git push gitlab david-dev
# git push p106 david-dev  # rejected (non-bare checked-out branch) — see Remotes note
```

### 2. Pull on UAT server

```bash
ssh p106-platform 'cd /opt/9router && git fetch origin && git reset --hard origin/david-dev'
```

### 3. Rebuild 9router-source — DETACHED (the build exceeds the 30s SSH client timeout)

`docker compose build` takes ~3–5 min; the `RUN chown -R node:node /app` step alone takes
~4 min and the log looks frozen — it is **not** stuck. A foreground build gets killed when
the SSH client times out, leaving a half-built / un-tagged image. Launch it detached and
**poll a log**; never re-launch (a second build will compete with the first):

```bash
ssh p106-platform 'cd /opt/9router && setsid docker compose build --no-cache 9router > /tmp/9router-build.log 2>&1 < /dev/null &'
```

> The launch `ssh` may report a client "timeout"/stderr error — that is expected and
> harmless. The build keeps running on the server. Poll instead:

```bash
ssh p106-platform 'tail -5 /tmp/9router-build.log'          # wait for "Image 9router:local Built"
ssh p106-platform 'docker images 9router:local'             # confirm new image id landed
```

Stop polling only when the log ends with `Image 9router:local Built` (and a
`writing image sha256:...` line). `9router:local` must show a new image ID.

> ⚠️ **Always use `--no-cache`** — Docker's build cache can reuse the `COPY . ./` layer
> even when source files changed, resulting in a container with stale code.

### 4. Recreate the container — DETACHED + VERIFY (this step prevents the outage)

`docker compose up -d --force-recreate` creates the new container, but the **start step
can be interrupted** if the SSH client dies on benign stderr (e.g. the `9router-data`
volume "already exists" warning). That leaves the container in `Created` state — i.e. DOWN.
So: run it detached, then **always verify it is `Up`**, and recover if it is not.

```bash
ssh p106-platform 'cd /opt/9router && setsid docker compose up -d --force-recreate 9router > /tmp/9router-up.log 2>&1 < /dev/null &'
```

> Use `grep`, NOT `docker ps --format` — the `{{ }}` template breaks through SSH quoting.

```bash
ssh p106-platform 'docker ps | grep 9router-source'
```

- Shows `Up ...` → done.
- Shows `Created` (not started) → **recover immediately**:

  ```bash
  ssh p106-platform 'docker start 9router-source'
  ssh p106-platform 'docker ps | grep 9router-source'   # must now show Up
  ```

> The volume warning (`volume "9router-data" already exists ... Use external: true`) is
> benign. To silence it permanently (and remove the stderr noise that can interrupt the
> up command), mark the volume `external: true` in `docker-compose.yml` — the `9router-data`
> volume is pre-created by Docker, not by compose.

### 5. Verify

```bash
# New code live?
ssh p106-platform 'curl -s http://localhost:20130/api/health'   # -> {"ok":true}

# Master still up (fallback must never go down)?
ssh p106-platform 'curl -s http://localhost:20131/api/health'   # -> {"ok":true}

# Both containers running?
ssh p106-platform 'docker ps | grep 9router'
```

### 6. Check logs for errors

```bash
ssh p106-platform 'docker logs 9router-source --tail 20'
```

## Rollback

If the new code breaks 9router-source:

```bash
ssh p106-platform 'cd /opt/9router && git revert HEAD && docker compose build --no-cache 9router && docker compose up -d --force-recreate 9router'
```

Or switch traffic to master (port 20131) while debugging.

## Safety Rules

- **Never rebuild both containers at the same time** — always one at a time
- **Never `docker compose down`** without specifying the service — that kills headroom too
- **Always verify master is still up** after rebuilding source
- **Data volume is shared** — both containers read/write the same `9router-data`
- **Branch**: `david-dev` is the active development branch for 9router-source
- **Run build AND up DETACHED** (`setsid ... > log 2>&1 < /dev/null &`) — the build exceeds
  the 30s SSH client timeout, and a killed client can leave the container unstarted (the
  exact cause of a past "UAT died" outage where the container was stuck in `Created`)
- **Always verify `9router-source` is `Up` after recreate**; if it is `Created`,
  `docker start 9router-source` recovers it. A `Created` container = UAT is down
- **Do NOT re-launch a build/up the client reported as "timed out"** — it is almost
  certainly still running on the server; re-launching starts a second competing build
