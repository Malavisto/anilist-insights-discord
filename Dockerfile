# Use an official Node runtime as the base image
FROM node:23.8.0-alpine

# Set working directory in the container
WORKDIR /usr/src/app

# Install system dependencies
RUN apk add --no-cache tzdata

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Use a non-root user for security
USER node

# Add logging volume
VOLUME ["/usr/src/app/logs"]

# Expose metrics port
EXPOSE 9090

# Command to run the bot
CMD ["npm", "start"]
