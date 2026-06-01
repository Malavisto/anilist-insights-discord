#!/usr/bin/env bash

set -euo pipefail

SESSION_NAME="anilist-bot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Usage: %s {start|stop|status|attach}\n' "$0"
}

session_exists() {
  tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

wait_for_shutdown() {
  local attempts=0
  local max_attempts=20

  while session_exists; do
    if [ "$attempts" -ge "$max_attempts" ]; then
      printf 'Timed out waiting for %s to exit cleanly\n' "$SESSION_NAME" >&2
      return 1
    fi

    sleep 0.5
    attempts=$((attempts + 1))
  done
}

start() {
  if session_exists; then
    printf '%s is already running\n' "$SESSION_NAME"
    return 0
  fi

  tmux new-session -d -s "$SESSION_NAME" -c "$ROOT_DIR" "pnpm start"
  printf 'Started %s\n' "$SESSION_NAME"
}

stop() {
  if ! session_exists; then
    printf '%s is not running\n' "$SESSION_NAME"
    return 0
  fi

  tmux send-keys -t "$SESSION_NAME" C-c
  if wait_for_shutdown; then
    printf 'Stopped %s\n' "$SESSION_NAME"
  fi
}

status() {
  if session_exists; then
    printf '%s is running\n' "$SESSION_NAME"
  else
    printf '%s is not running\n' "$SESSION_NAME"
  fi
}

attach() {
  if ! session_exists; then
    printf '%s is not running\n' "$SESSION_NAME" >&2
    return 1
  fi

  exec tmux attach -t "$SESSION_NAME"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  attach) attach ;;
  *) usage; exit 1 ;;
esac
