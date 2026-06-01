# AGENTS.md

- Use `pnpm` for local work. `package.json` pins pnpm `10.14.0`, and the only repo script is `pnpm start`.
- Start the app with `pnpm start` or `node app.js`. The README's `node start` example is not a real command.
- `app.js` is the entrypoint. It loads `dotenv`, reads `DISCORD_TOKEN`, starts the Discord client, and serves Prometheus metrics on `METRICS_PORT` (default `9090`) at `/metrics`.
- `logger.js` creates `./logs` on startup and writes `info.log` and `error.log` there.
- Slash commands are registered per guild on `ready`: `randomanime`, `animestats`, `animerecommend`, `animecover`. Keep command names, option names, and the matching handler switch in sync.
- Command logic lives in `modules/`, one service per feature. `CacheService` is shared; caches are in-memory TTL maps and are not persistent.
- There is no `test`, `lint`, or `typecheck` script in this repo. Verify changes by running the bot or the smallest path that exercises the edited module.
- Docker builds use `pnpm install --frozen-lockfile` and run `pnpm start` in `node:23.11.1-alpine`.
- `compose.yml` expects an external Docker network named `services`, mounts `./logs`, and exposes metrics on container port `9090`.
- The deploy workflow on `main` SSHes to the host, runs `git pull`, `npm install --production`, then restarts the `anilist-discord` systemd service. If you change startup or dependencies, check both the pnpm path and this deploy path.
- Prometheus config in `prometheus/prometheus.yml` scrapes `anilist-discord-bot:9090`; if you change the metrics port or container name, update that file too.
