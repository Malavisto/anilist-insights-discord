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

1. [Bun](https://bun.com/) version 4.1.0 or later installed or [Docker](https://www.docker.com/) with docker compose.
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

The bot will log in and register the commands in all the servers it's added to.

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
2. The bot generate recomendations based on your anilist and pick one out of five anime and display its details in an embed.

### Anime Stats

1. Use the `/animestats` command in Discord and provide your AniList username.
2. The bot will generate stats from your AniList and display them an embed.

### Anime Cover (Not used much)

1. Use the `/animecover` command in discord and provide an AniList anime ID
2. The bot will fetch the cover and serve an embed with the link

## Development

### Prerequisites

1. [Bun](https://bun.com/) version 4.1.0 or later installed.
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
