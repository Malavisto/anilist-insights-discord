# Anilist Insights for Discord

A Discord bot that connects with [AniList](https://anilist.co/) to do multiple tasks based on a user's AniList profile.

## Disclaimers

This project was made as an testing ground for [me](https://github.com/malavisto) to experiment with AI, I do try to maintain the repo on my own though

**This bot is not affiliated with [Anilist](https://anilist.co) nor [Discord](https://discord.com)**

**Most parts of this repo are AI-Generated**

## Features

- Fetches a random anime from an Anilist account.
- Fetches a random manga from an AniList account.
- Generates stats from an Anilist Account.
- Generates a recomendation based on an Anilist account and fetches it.
- Interactive slash commands with error handling for invalid usernames or empty lists.
- Has a built-in prometheus endpoint and decent logging.

## Setup

### Prerequisites

1. [Bun](https://bun.com/) 1.4.x installed or [Docker](https://www.docker.com/) with docker compose.
2. A Discord bot token. Create one on the [Discord Developer Portal](https://discord.com/developers/applications).
3. Install dependencies **Bun Only**:
   ```
   bun install
   ```

### Configuration

1. Create a .env file with the [example](https://github.com/Malavisto/anilist-randomizer-discord/blob/main/.env.example)
   ```
   cp .env.example .env
   ```
2. Modify environment variables in the .env

3. Make sure your bot has the required Discord permissions:
   - Slash commands
   - Read and send messages in the target channels.

### Running the Bot

Start the bot by running:

```
bun start
```

or

```
docker compose up -d
```

The bot registers all five commands at startup and whenever it joins a new server. Registration failures are isolated to each server. Construction does not start the bot; `initializeBot()` awaits HTTP listening and Discord login. Startup failures clean up resources and exit nonzero. Shutdown attempts every cleanup and has a 10-second deadline.

To run it in the background with tmux:

```
bun bot:start
bun bot:stop
bun bot:status
bun bot:attach
```

`bun bot:stop` sends a clean shutdown signal so Discord sees the bot disconnect properly.

## Usage

### Random Anime

1. Use the `/animerandom` command in Discord and provide your AniList username.
2. The bot will fetch a random anime from your AniList and display its details in an embed.

### Random Manga

1. Use the `/mangarandom` command in Discord and provide your AniList username.
2. The bot will fetch a random manga from your AniList and display its details in an embed.

### Anime Recomendations

1. Use the `/animerecommend` command in Discord and provide your AniList username.
2. The bot uses your three highest-rated unique titles to select genres and caches up to five unseen recommendations for five minutes. Duplicate entries keep their highest score (first occurrence on ties); all listed titles, including unrated entries, are excluded.
3. Each uncached operation has a 30-second deadline, one list request and at most ten candidate requests of 25 titles each. Each request also has a 10-second timeout. Searches stop at a full pool, final/empty/repeated page, request limit, or deadline. Distinct seen-only pages allow further searching. Partial results at a search limit are cached; HTTP and GraphQL failures remain errors.
4. Cached selections avoid consecutive repeats when alternatives exist.

### Anime Stats

1. Use the `/animestats` command in Discord and provide your AniList username.
2. The bot will generate stats from your AniList and display them an embed.

### Anime Cover (Not used much)

1. Use the `/animecover` command in discord and provide an AniList anime ID
2. The bot will fetch the cover and serve an embed with the link

## Development

### Prerequisites

1. [Bun](https://bun.com/) 1.4.x installed.
2. A Discord bot token. Create one on the [Discord Developer Portal](https://discord.com/developers/applications).
3. Install dependencies:
   ```
   bun install
   ```

### Configuration

1. Create a .env file with the [example](https://github.com/Malavisto/anilist-randomizer-discord/blob/main/.env.example)
   ```
   cp .env.example .env
   ```
2. Modify environment variables in the .env

3. Make sure your bot has the required Discord permissions:
   - Slash commands
   - Read and send messages in the target channels.

### Running the Bot

Start the bot by running:

```
bun start
```

Or use the tmux wrapper for background runs:

```
bun bot:start
bun bot:stop
bun bot:status
bun bot:attach
```

## Development Notes

- The project uses:
  - [discord.js](https://discord.js.org) for Discord integration.
  - [Axios](https://axios-http.com/) for AniList API requests.
  - [Jest](https://jestjs.io/) for testing suite
  - Slash commands for an interactive experience.
- Errors and logging are handled with a custom logger for better debugging.

### Key Files

- **modules/commands/**: Slash command services.
- **modules/shared/**: AniList requests, cache, embed, and reply helpers.
- **modules/observability/**: Logger and Prometheus metrics singletons.
- **app.js**: Main application logic.
- **.env**: Stores sensitive configuration variables.

## Contributions

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Validation

Use Bun 1.4.x and `bun run test` for the full Jest suite. Tests use mocked AniList HTTP and need no token or `.env`. Run `bun run test:coverage`, `bun run lint`, and `bun run format:check` before delivery. Only the ESLint step is advisory in CI; dependency installation, formatting, tests, coverage, and aggregate results remain blocking. Features and fixes follow the repository's test-first workflow.

## Readiness and deployment

`/readyz` on `METRICS_PORT` (default 9090) returns 200 only while HTTP is listening, Discord is ready, and shutdown has not started; connecting, disconnected, and stopping states return 503. This verifies the Discord connection, not AniList availability or command registration in every server. `/metrics` and the Prometheus target `anilist-discord-bot:9090` are unchanged.

Compose probes readiness with Bun inside the bot container: a 3-second request timeout, 5-second interval, 20-second start period, and five retries. Docker allows 4 seconds for the probe process to exit. Watchtower updates are disabled for this bot.

Feature branches merge into `dev`; only `dev` merges into `main`. The deployment workflow serializes rollouts without cancelling an active deployment. It passes the build's immutable image digest and matching repository SHA to `scripts/deploy.sh`. The remote host needs Bash, Git, Docker Compose v2, `flock`, registry access, and the restricted passwordless sudo permissions defined in `ops/sudoers/anilist-deploy`. Docker operations run through `sudo -n /usr/local/sbin/anilist-docker`, an administrator-owned helper with eight exact sudoers entries compatible with sudo-rs. The helper validates image/project values from stdin; no sudoers regexes or unrestricted Docker permissions are required. An administrator must install both `ops/anilist-docker` and the replacement `ops/sudoers/anilist-deploy` policy on the external server before rollout; preparing these files locally does not change remote permissions.

The script runs from `/opt/anilist-discord`, rejects tracked local modifications, fetches Git updates and pulls the selected image before replacing services, and checks the image revision label against the selected SHA, and preserves the existing Compose project name from the running bot container. An existing `anilist-discord-bot` is required. It reads the previous repository revision from the running image's `org.opencontainers.image.revision` label (which must be present and available locally in Git), and saves it with the actual Docker image ID in `.deployment/previous`. Keep that local image available for rollback. It checks out the selected SHA and persists its image in `.deployment/compose.yml`; the base Compose environment, mounts, and Prometheus target still apply. It pulls the remaining services before `up -d`, without an initial `down`, then polls container health for at most 120 seconds. Unhealthy, terminated, missing containers, and timeouts fail the job. Failed rollouts are left for manual investigation; there is no automatic rollback.

For manual rollback, from the deployment checkout run:

```bash
bash scripts/deploy.sh rollback
```

Rollback restores the saved revision and image and uses the same readiness verification. Save a copy of the current deployment script outside the checkout before rolling back across its introduction; old revisions may not contain it. An image predating `/readyz` cannot pass this readiness check, so validate the initial migration recovery procedure separately on the host. Host state is protected by a local deployment lock. Avoid independent Compose or Watchtower updates during a rollout.

For subsequent manual Compose operations, run from the remote deployment checkout and supply the saved project name to the fixed helper:

```bash
sed -n '3p' .deployment/previous | sudo -n /usr/local/sbin/anilist-docker compose-up
```

This retains the persisted override and project identity. The helper and its parent directories must be root-owned and not writable by the deployment user; helper updates require administrator review and installation.

Production rollouts and external Grafana dashboards have not been verified by the local tests.
