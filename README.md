# Anilist Insights for Discord

A Discord bot that connects with [AniList](https://anilist.co/) to do multiple tasks based on a user's AniList profile.


## Disclaimers

This project was made as an testing ground for [me](https://github.com/malavisto) to experiment with AI, I do try to maintain the repo on my own though

**This bot is not affiliated with [Anilist](https://anilist.co) nor [Discord](https://discord.com)**

**Most parts of this repo are AI-Generated**

## Features

- Fetches a random anime from an Anilist account.
- Generates stats from an Anilist Account.
- Generates a recomendation based on an Anilist account and fetches it.
- Interactive slash commands with error handling for invalid usernames or empty lists.
- Has a built-in prometheus endpoint and decent logging.

## Setup

### Prerequisites

1. [Node.js](https://nodejs.org/) version 23 or later installed or [Docker](https://www.docker.com/) with docker compose.
2. A Discord bot token. Create one on the [Discord Developer Portal](https://discord.com/developers/applications).
4. Install dependencies **NodeJS Only**:
   ```
   pnpm install
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
pnpm start
```
or 
```
docker compose up -d
```

The bot will log in and register the commands in all the servers it's added to.

To run it in the background with tmux:

```
pnpm bot:start
pnpm bot:stop
pnpm bot:status
pnpm bot:attach
```

`pnpm bot:stop` sends a clean shutdown signal so Discord sees the bot disconnect properly.

## Usage

### Random Anime
1. Use the `/animerandom` command in Discord and provide your AniList username.
2. The bot will fetch a random anime from your AniList and display its details in an embed.

### Anime Recomendations
1. Use the `/animerecommend` command in Discord and provide your AniList username.
2. The bot generate recomendations based on your anilist and pick one out of five anime and display its details in an embed.

### Anime Stats
1. Use the `/animestats` command in Discord and provide your AniList username.
2. The bot will generate stats from your AniList and display them an embed.

## Development

### Prerequisites

1. [Node.js](https://nodejs.org/) version 23 or later installed.
2. A Discord bot token. Create one on the [Discord Developer Portal](https://discord.com/developers/applications).
4. Install dependencies:
   ```
   pnpm install
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
pnpm start
```

Or use the tmux wrapper for background runs:

```
pnpm bot:start
pnpm bot:stop
pnpm bot:status
pnpm bot:attach
```

## Development Notes

- The project uses:
  - [discord.js](https://discord.js.org) for Discord integration.
  - [Axios](https://axios-http.com/) for AniList API requests.
  - Slash commands for an interactive experience.
- Errors and logging are handled with a custom logger for better debugging.

### Key Files

- **modules/** Custom modules used by main app
- **app.js**: Main application logic.
- **logger.js**: Logging module.
- **metrics.js**: Prometheus metrics module.
- **.env**: Stores sensitive configuration variables.

## Contributions

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
