---
description: Triage a failed GitHub Actions run — classify transient vs real, recommend rerun or fix
argument-hint: "[run-id | workflow-name] (optional; defaults to latest failures)"
allowed-tools: Bash(gh run list:*), Bash(gh run view:*), Bash(gh run rerun:*), Bash(gh run watch:*), Bash(gh api:*), Read
---

You are triaging GitHub Actions failures for the **mini-macau** repo. Goal: decide whether a
failure is a **transient upstream/infra blip** (→ rerun) or a **real code/data bug** (→ investigate),
and say so explicitly. Do **not** blindly `gh run rerun` everything, and do **not** start editing
code before you've classified the failure.

## Step 1 — Find the failing run

If `$ARGUMENTS` is a run id, use it directly. If it's a workflow name, filter to it. Otherwise list
recent failures:

```
gh run list --status failure --limit 10
```

Then pull the failed job + the failing step's log tail:

```
gh run view <run-id> --log-failed
```

Identify **which workflow** failed and **which step** (scrape / `validate_output.py` / `git push` /
lint / test / build / deploy / docker).

## Step 2 — Classify against known failure modes

These are the cataloged modes for this repo (see the `project-ci-failure-modes` memory for the full
catalog). Match the log to one:

**TRANSIENT → rerun first, it usually clears:**
- **`Bus Service Status` — HTTP 415 on all ~91 routes**, then the guard trips
  (`NN/NN routes errored — refusing to write service-status.json`, exit 1). This is a Cloudflare
  bot-challenge on the Azure/GitHub runner IP, not a bug. The guard is working as designed; the live
  site keeps serving last-good data. (See `project-busstatus-cloudflare-415` memory.)
- **`Update Flight Data` / `Update Flight Timetable` — safety guard tripped (0 rows parsed across
  both upstream pages)** after the in-job retry. Upstream flaked for a stretch; `flights.json` was
  correctly NOT overwritten with `[]`. The workflow already has an outer 2-attempt + in-process
  3-attempt retry; a failure means the whole window flaked.
- **Any data workflow — `push failed after N attempts` / `rebase conflict — aborting`.** Two
  scheduled jobs raced on `master`. Each touches a different JSON file so a real conflict is rare;
  a rerun lands cleanly once the other job's commit is in.

**REAL — do NOT just rerun; investigate:**
- **`CI` workflow failing on lint / test / typecheck-build / `validate_output.py all`.** This gates
  PRs and pushes — a failure here is a genuine code or committed-data defect. Read the log, find the
  offending file/test, fix it. `npm run lint` / `npm test` / `npm run build` reproduce locally.
- **A data scraper that fails 415/guard *persistently across multiple reruns*.** No longer transient —
  upstream changed layout or the block became sticky. Escalate to a code fix (e.g. TLS-impersonation
  via `curl_cffi`, or teach the guard to distinguish an all-routes block from a layout change).
- **`Deploy to Cloudflare Pages` failing on lint/test/build** (it re-runs the CI gate) → same as a CI
  failure. Failing on the `wrangler` step → check `CLOUDFLARE_API_TOKEN` / account id secrets.

**BY DESIGN — not a failure:**
- Data committed but the **live site didn't update**: pushes via the default `GITHUB_TOKEN` don't fire
  `on: push` (anti-recursion), so each data workflow calls `deploy.yml` via `workflow_call` only when
  it committed a change. Confirm the run's `deploy` job was invoked; if `changed=false`, there was
  simply nothing new to ship.

## Step 3 — Recommend, then act with confirmation

State the classification and the one-line reason. Then:
- **Transient:** propose `gh run rerun <run-id>` (or `--failed` to retry only failed jobs). Run it
  only after the user confirms, then optionally `gh run watch <new-run-id>` to report the result.
- **Real:** summarize the root cause and the file/step to fix. Do not rerun. Hand back a concrete
  next step (which test, which scraper, which secret).

Keep the final answer short: **workflow + step → classification → reason → recommended action.**
