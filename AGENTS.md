# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

A Discord bot (discord.js v14) that answers `/animerandom`, `/mangarandom`, `/animestats`, `/animerecommend`, and `/animecover` slash commands by querying the AniList GraphQL API. Plain CommonJS Bun (1.4.x).

## Commands

```bash
bun install                # deps
bun start                  # run the bot (needs DISCORD_TOKEN in .env)
bun run test                   # full Jest suite
bun run test:unit              # or :integration / :e2e by tier
bun run test:coverage          # enforces thresholds (70% branches/functions, 80% lines/statements)
bun run test -- CacheService.test.js        # single file
bun run test -- CacheService.test.js -t "test name"   # single case
bun bot:start|stop|status|attach      # tmux session `anilist-bot`; stop sends SIGINT for graceful shutdown
```

Tests need no `.env` or real tokens — all AniList HTTP is mocked with `axios-mock-adapter`. ESLint (flat config in `eslint.config.mjs`) and Prettier are wired up via the `lint` / `lint:fix` / `format` / `format:check` scripts, and CI's lint job is blocking.

## Architecture

### Command wiring (key cross-file invariant)

`app.js` builds a single command registry during initialization from each service's static `commandDefinition` (`{ builder, methodName, metricName }`). Registration and dispatch both use that registry. Add a service once to the constructor's service list when adding a command.

Handlers return `true` on success and `false` after reporting a failure. The dispatcher records that outcome through `metricsService.trackCommand(...)` and ends the timer in `finally`.

### Service pattern (`modules/commands/`)

One service per command (`RandomAnimeService`, `RandomMangaService`, `AnimeStatsService`, `AnimeCoverService`, `AnimeRecommendationService`). Each follows the same three-part shape:

- `fetchX(username)` — checks its own `CacheService` first, then uses `anilistRequest` to POST a GraphQL query to `https://graphql.anilist.co` via axios with `AbortSignal.timeout(10000)`; throws on empty/invalid results.
- `createEmbed(...)` — builds the discord.js `EmbedBuilder` reply.
- `handleXCommand(interaction)` — `deferReply` → fetch → `editReply`. Services catch their own fetch errors, log them, and post the user-facing error message; `app.js` only logs anything that escapes.

The two `Random*` services deliberately split their fetch into two GraphQL queries — one to grab the user's media ID list, then one to fetch the randomly chosen entry's details. Don't merge these into a single query.

Each cache-enabled service constructor (all except `AnimeCoverService`) creates a **private** `CacheService`: in-memory TTL Map (5-min TTL, 60s background sweep, `unref()`'d timer), keyed like `recommendation_${username}` (the `Random*` services cache the fetched ID list first, e.g. `manga_ids_${username}`). Recommendations cache up to five unseen candidates and choose again per command, avoiding consecutive repeats when alternatives exist. Caching is per-process only — nothing persists across restarts.

Shared helpers live in `modules/shared/`. `anilistRequest` owns HTTP timeout, headers, GraphQL error validation, and per-request metrics. Cache hits only increment cache metrics. Shared embed and last-resort reply helpers live in `embedHelpers.js` and `replyError.js`.

### Singletons

Services use these singletons directly or through shared helpers:

- `modules/observability/metrics.js` — `MetricsService` singleton over `@prometheus-io/client`. `trackApiRequest`/`updateUserStats` **sha256-hash usernames** (12 chars) before they enter metric labels — never pass raw usernames into labels. Metric-tracking methods swallow their own errors.
- `modules/observability/logger.js` — winston singleton; JSON logs to `logs/info.log` and `logs/error.log` (runtime artifacts, not source).

## Testing

Three tiers under `__tests__/`: `unit/` (one file per service), `integration/` (cross-service interactions), `e2e/` (full command flows against mock Discord interactions). `__tests__/setup.js` sets `NODE_ENV=test` and the global 10s timeout. New services get a unit test following the existing pattern: `jest.mock` logger/metrics, wrap axios in `MockAdapter`. Coverage thresholds above will fail `test:coverage` if dropped.

## Operations

- Config lives in `.env` (`DISCORD_TOKEN`, optional `METRICS_PORT`, default 9090 where the in-process Express server exposes `/metrics`).
- `compose.yml` ships the bot plus watchtower (auto-pulls `ghcr.io/malavisto/anilist-insights-discord:main`) and Prometheus scraping `anilist-discord-bot:9090` via `prometheus/prometheus.yml` — update that file if the container name or port changes.
- Pushes to `main` deploy via SSH to `/opt/anilist-discord` and recreate the Docker Compose stack (`.github/workflows/deploy.yml`). Keep `compose.yml`, Prometheus configuration, and that workflow consistent when touching deployment config.
- Feature branches merge into `dev` via PR; only `dev` merges into `main`, which triggers deployment.

## Conventions

- Conventional commits (`fix:`, `feat:`, `ci:`, `docs:`, `chore:`, `chore(deps):`, `ops:`).
- Agent-authored commits must include a `Co-authored-by` trailer identifying the agent.
- Always check and fix formating with prettier after writing and before commits
