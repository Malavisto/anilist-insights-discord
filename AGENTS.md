# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

A Discord bot (discord.js v14) that answers `/animerandom`, `/mangarandom`, `/animestats`, `/animerecommend`, and `/animecover` slash commands by querying the AniList GraphQL API. Plain CommonJS Node.js (24+), installed with nvm with no build step or TypeScript; package manager is pnpm, pinned via `packageManager`.

## Commands

```bash
pnpm install                # deps
pnpm start                  # run the bot (needs DISCORD_TOKEN in .env)
pnpm test                   # full Jest suite
pnpm test:unit              # or :integration / :e2e by tier
pnpm test:coverage          # enforces thresholds (60% branches/functions, 70% lines/statements)
pnpm test -- CacheService.test.js        # single file
pnpm test -- CacheService.test.js -t "test name"   # single case
pnpm bot:start|stop|status|attach      # tmux session `anilist-bot`; stop sends SIGINT for graceful shutdown
```

Tests need no `.env` or real tokens — all AniList HTTP is mocked with `axios-mock-adapter`. There is no local lint/typecheck script; CI's ESLint step is deliberately non-blocking (`|| true`), so the Jest tiers are the meaningful checks.

## Architecture

### Command wiring (key cross-file invariant)

`app.js` owns **both halves** of every slash command, and they must stay in sync:

1. `registerSlashCommands(guild)` — builds the command list from each service's static `commandDefinition.builder`, registered per-guild on client ready via bulk overwrite (`guild.commands.set`).
2. The `interactionCreate` handler dispatches through a `commandHandlers` map of `{ commandName: [serviceInstance, methodName, metricName] }`, keyed off the same `commandDefinition`.

Each service owns a static `commandDefinition` getter (`{ builder, methodName, metricName }`) that is the single source of truth for its command name, handler method, and metric — but `app.js` still lists every service explicitly in **both** places, so they must stay in sync by hand. Adding/renaming a command means adding/updating the `commandDefinition` in the service in `modules/`, then referencing it in both places in `app.js`. The dispatcher wraps each call in `metricsService.trackCommand(...)`, invoking the returned end-timer with `'success'`/`'failure'` in a `finally` block.

### Service pattern (`modules/`)

One service per command (`RandomAnimeService`, `RandomMangaService`, `AnimeStatsService`, `AnimeCoverService`, plus `animeRecommendation.js` exporting `AnimeRecommendationService` — filename doesn't match export). Each follows the same three-part shape:

- `fetchX(username)` — checks its own `CacheService` first, then POSTs a GraphQL query to `https://graphql.anilist.co` via axios with `AbortSignal.timeout(10000)`; throws on empty/invalid results.
- `createEmbed(...)` — builds the discord.js `EmbedBuilder` reply.
- `handleXCommand(interaction)` — `deferReply` → fetch → `editReply`. Services catch their own fetch errors, log them, and post the user-facing error message; `app.js` only logs anything that escapes.

The two `Random*` services deliberately split their fetch into two GraphQL queries — one to grab the user's media ID list, then one to fetch the randomly chosen entry's details. Don't merge these into a single query.

Each service constructor creates a **private** `CacheService`: in-memory TTL Map (5-min TTL, 60s background sweep, `unref()`'d timer), keyed like `recommendation_${username}` (the `Random*` services cache the fetched ID list first, e.g. `manga_ids_${username}`). Caching is per-process only — nothing persists across restarts.

### Singletons

Every module requires these two directly:

- `metrics.js` — `MetricsService` singleton over `@prometheus-io/client`. `trackApiRequest`/`updateUserStats` **sha256-hash usernames** (12 chars) before they enter metric labels — never pass raw usernames into labels. Metric-tracking methods swallow their own errors.
- `logger.js` — winston singleton; JSON logs to `logs/info.log` and `logs/error.log` (runtime artifacts, not source).

## Testing

Three tiers under `__tests__/`: `unit/` (one file per service), `integration/` (cross-service interactions), `e2e/` (full command flows against mock Discord interactions). `__tests__/setup.js` sets `NODE_ENV=test` and the global 10s timeout. New services get a unit test following the existing pattern: `jest.mock` logger/metrics, wrap axios in `MockAdapter`. Coverage thresholds above will fail `test:coverage` if dropped.

## Operations

- Config lives in `.env` (`DISCORD_TOKEN`, optional `METRICS_PORT`, default 9090 where the in-process Express server exposes `/metrics`).
- `compose.yml` ships the bot plus watchtower (auto-pulls `ghcr.io/malavisto/anilist-insights-discord:main`) and Prometheus scraping `anilist-discord-bot:9090` via `prometheus/prometheus.yml` — update that file if the container name or port changes.
- Pushes to `main` deploy via SSH to `/opt/anilist-discord` and restart the `anilist-discord.service` systemd unit (`.github/workflows/deploy.yml`). Keep `compose.yml`, `systemd/anilist-discord.service`, and that workflow pointing at the same path/port when touching deployment config.
- Feature branches merge into `dev` via PR; only `dev` merges into `main`, which triggers deployment.

## Conventions

- Conventional commits (`fix:`, `feat:`, `ci:`, `docs:`, `chore:`, `chore(deps):`, `ops:`).
- Agent-authored commits must include a `Co-authored-by` trailer identifying the agent.
