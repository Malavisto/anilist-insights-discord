# Repository Guide

## Runtime
- Use `pnpm` (pinned to `11.13.0`). `pnpm start` runs the CommonJS bot entrypoint, `app.js`.
- `DISCORD_TOKEN` is required. The in-process Express metrics endpoint serves `/metrics` on `METRICS_PORT`, defaulting to `9090`.
- `pnpm bot:start|stop|status|attach` manages the `anilist-bot` tmux session; `stop` sends `SIGINT` and waits for the bot's graceful shutdown.
- `logger.js` creates `logs/` and writes `info.log` and `error.log`; these are runtime artifacts, not source changes.

## Application Changes
- Command services live in `modules/`; `CacheService` is an in-memory TTL cache with a background sweep, so cached data is not persistent.
- Slash commands are registered per guild in `app.js` when the client becomes ready. When adding or changing a command, update both `registerSlashCommands` and the `interactionCreate` switch.
- Current commands are `randomanime`, `animestats`, and `animerecommend` with a required `username`, plus `animecover` with a required `animeid`.

## Verification
- Run `pnpm test` for the full Jest suite, or `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:e2e` by tier. Focus a test with `pnpm test -- CacheService.test.js` or `-t "test name"`.
- Tests run in Node with `__tests__/setup.js` and a 10-second timeout; AniList HTTP calls are mocked with `axios-mock-adapter`.
- There is no local lint or typecheck script. CI's ESLint invocation is explicitly non-blocking; the three Jest tiers are the meaningful checks.

## Operations
- Docker builds from `node:krypton-alpine`, installs with `pnpm install --frozen-lockfile`, runs as `node`, mounts `logs/`, and exposes port `9090`.
- `prometheus/prometheus.yml` targets `anilist-discord-bot:9090`; update it with metrics container or port changes.
- Main-branch deployment uses `/opt/anilist-discord` consistently across `.github/workflows/deploy.yml` and `systemd/anilist-discord.service`. Keep both (and `compose.yml`) pointing at the same paths and ports when changing deployment or service configuration.
- Agent-authored commits must include a `Co-authored-by` trailer identifying the agent.
