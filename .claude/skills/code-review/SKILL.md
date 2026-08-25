---
name: code-review
description: Review pull requests, diffs, and proposed changes in this AniList Discord bot for actionable bugs, regressions, security issues, and missing tests across application and operational files. Use when reviewing a PR, commit, diff, patch, or proposed change in this repository.
---

# Code Review

Review all changed files of a pull request, commit, diff, patch, or proposed
change in this repository, including application code, tests, workflows,
Docker, Prometheus, systemd, and documentation when they affect runtime
behavior or operations.

## Review Workflow

1. Inspect the working tree and the complete relevant diff before forming
   conclusions. Read surrounding implementation and related tests, not only
   changed lines.
2. Use the repository guidance docs (`CLAUDE.md`, `AGENTS.md`, `README.md`,
   `TESTING.md`) and the applicable configuration files as behavioral and
   operational context.
3. Trace changed behavior through its callers, error paths, external APIs,
   Discord interaction lifecycle, and shutdown lifecycle.
4. Check whether the change is covered by an appropriate Jest tier. Prefer
   running the narrowest relevant test first, then broader tests when useful.
5. Report only issues introduced by the change or regressions it exposes. Do
   not report pre-existing defects unless the change makes them materially
   worse.

## Repository Checks

### Application

- For changes to `app.js`, verify every slash command is updated consistently
  in both `registerSlashCommands` and the `commandHandlers` dispatch map in
  the `interactionCreate` handler.
- Verify required command options remain aligned with the documented commands:
  `randomanime`, `animestats`, and `animerecommend` require `username`; `animecover`
  requires `animeid`.
- Check Discord interactions are acknowledged exactly once and within Discord's
  response window, including success, empty-result, validation, and exception
  paths.
- Check AniList requests for correct query variables, response-shape handling,
  useful error behavior, and avoidance of leaking tokens or user data in logs
  or Discord messages.
- For changes under `modules/`, inspect cache key construction, TTL behavior,
  expiration boundaries, background sweep cleanup, and timer/resource cleanup.
- Check metrics changes for stable metric names and labels, correct success and
  failure accounting, and graceful behavior when the metrics endpoint starts
  or shuts down.
- Check environment-variable changes against `.env.example` and avoid adding
  secrets to source, tests, logs, images, or compose configuration.

### Tests

- Unit tests should cover service logic and edge cases without real AniList
  calls. HTTP calls are mocked with `axios-mock-adapter`.
- Integration tests should verify service boundaries and interactions that are
  not adequately covered by isolated unit tests.
- E2E tests should cover command behavior and Discord-facing interaction paths.
- Check tests for assertions that would pass accidentally, especially around
  rejected promises, Discord replies, cache expiry, and malformed API data.
- Use the repository's `pnpm` scripts and pinned `pnpm@11.13.0`; do not infer
  test success from a non-running or silently skipped suite.

### Operations

- For dependency changes, verify both `package.json` and `pnpm-lock.yaml` are
  consistent. Treat unrelated lockfile churn as suspicious.
- Check Docker changes preserve the non-root `node` runtime, expected log
  volume behavior, metrics port `9090`, and the production install strategy.
- Check metrics endpoint or port changes against
  `prometheus/prometheus.yml` and compose service names.
- Check deployment changes against both `.github/workflows/deploy.yml` and
  `systemd/anilist-discord.service`; both use `/opt/anilist-discord`. Flag
  changes that introduce or worsen an inconsistent path or port across these
  files and `compose.yml`.
- Check workflow changes for correct Node and pnpm versions, lockfile usage,
  test-tier coverage, failure propagation, and security of action inputs.
- Treat the CI ESLint command as non-blocking because it explicitly uses
  `|| true`; do not describe it as a reliable lint gate.

## Findings Standard

Findings are the primary output. Order them by severity and include a precise
`path:line` reference. A finding must explain the concrete impact and the
smallest practical fix; avoid style-only feedback unless it creates a real
correctness, security, reliability, or maintainability risk.

Use these severity levels:

- **P0**: Blocks deployment or causes catastrophic data, security, or service
  impact in normal use.
- **P1**: High-impact production bug, security issue, or likely regression that
  should be fixed before merge.
- **P2**: Standard bug, edge-case failure, operational risk, or important
  missing test.
- **P3**: Low-impact correctness or maintainability issue with a concrete
  future failure mode.

Format each finding as:

```text
[P1] path/to/file.js:42: Short issue title
Impact: Explain what fails, for whom, and under what conditions.
Fix: State the smallest practical correction.
```

Do not include praise, a generic change summary, or a rewritten patch in the
findings section. If no actionable findings exist, state exactly that and then
list residual testing gaps or verification limitations. Distinguish an
unverified check from a failed check, and include the commands run when they
materially support the conclusion.
