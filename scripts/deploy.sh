#!/usr/bin/env bash
# Run from /opt/anilist-discord; restricted passwordless sudo rules are required.
set -euo pipefail

mode=${1:-}
helper=(sudo -n /usr/local/sbin/anilist-docker)
state="$PWD/.deployment"
fail() { echo "$*" >&2; exit 1; }
tracked_status=$(git status --porcelain --untracked-files=no)
[[ -z "$tracked_status" ]] || fail 'Tracked local modifications block deployment'
mkdir -p "$state"
# Prevent manual rollback and workflow deployment from racing on the host.
exec 9>"$state/lock"
flock -n 9 || fail 'Another deployment is active'

case "$mode" in
  deploy)
    revision=${2:?Repository SHA required}
    image=${3:?Immutable image required}
    [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid repository SHA'
    [[ "$image" =~ ^ghcr.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || fail 'Image must be an immutable GHCR digest'
    git fetch origin "$revision"
    printf '%s\n' "$image" | "${helper[@]}" pull-image
    image_revision=$(printf '%s\n' "$image" | "${helper[@]}" image-revision)
    [[ "$image_revision" == "$revision" ]] || fail 'Image revision does not match requested repository SHA'
    previous_image=$("${helper[@]}" current-image)
    previous_revision=$(printf '%s\n' "$previous_image" | "${helper[@]}" image-revision)
    [[ "$previous_revision" =~ ^[a-f0-9]{40}$ ]] || fail 'Running image has no valid repository revision label'
    git cat-file -e "$previous_revision^{commit}"
    project=$("${helper[@]}" current-project)
    [[ -n "$project" && "$project" != '<no value>' ]] || fail 'Existing Compose project identity required'
    printf '%s\n%s\n%s\n' "$previous_revision" "$previous_image" "$project" > "$state/previous.tmp"
    mv "$state/previous.tmp" "$state/previous"
    ;;
  rollback)
    [[ -f "$state/previous" ]] || fail 'No saved deployment to roll back'
    { read -r revision; read -r image; read -r project; } < "$state/previous"
    printf '%s\n' "$image" | "${helper[@]}" image-exists >/dev/null
    ;;
  *) fail 'Usage: bash scripts/deploy.sh deploy SHA IMAGE | rollback';;
esac

git checkout --detach "$revision"
printf 'services:\n  discord-bot:\n    image: "%s"\n' "$image" > "$state/compose.tmp"
mv "$state/compose.tmp" "$state/compose.yml"
if [[ "$mode" == deploy ]]; then printf '%s\n' "$project" | "${helper[@]}" compose-pull; fi
printf '%s\n' "$project" | "${helper[@]}" compose-up
start=$SECONDS
for ((attempt=0; attempt<60 && SECONDS-start<120; attempt++)); do
  health=$("${helper[@]}" health)
  case "$health" in
    'running healthy') echo 'Bot is ready'; exit 0;;
    'running unhealthy') fail 'Bot is unhealthy';;
    'running starting'|'running ') ;;
    *) fail "Bot terminated or has no valid health state: $health";;
  esac
  sleep 2
done
fail 'Bot readiness timed out after at most 120 seconds'
