# Use an official Bun runtime as the base image
FROM oven/bun:1.4-slim AS base
WORKDIR /usr/src/app

# install dependencies into temp directory for cache
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy the rest of the application code
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Use a non-root user for security
USER bun

# Add logging volume
VOLUME ["/usr/src/app/logs"]

# Expose metrics port
EXPOSE 9090

# Command to run the bot
CMD ["bun", "app.js"]