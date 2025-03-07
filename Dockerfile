# Use an official Node runtime as the base image
FROM node:23.9.0-alpine

# Set working directory in the container
WORKDIR /usr/src/app

# Install system dependencies and pnpm
RUN apk add --no-cache tzdata
RUN npm install -g pnpm

# Copy package files first to leverage Docker cache
COPY pnpm-lock.yaml ./
COPY package.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Use a non-root user for security
USER node

# Add logging volume
VOLUME ["/usr/src/app/logs"]

# Expose metrics port
EXPOSE 9090

# Command to run the bot
CMD ["pnpm", "start"]