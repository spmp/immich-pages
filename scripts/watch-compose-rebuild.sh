#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  watch-compose-rebuild.sh --compose-file FILE [options]

Watches a trigger file continuously. When the file changes, runs:
  docker compose -f FILE build [SERVICE]
  docker compose -f FILE up -d --no-deps --force-recreate [SERVICE]

Options:
  -f, --compose-file FILE  Compose file to operate on (required)
  -s, --service NAME       Build/recreate only this Compose service (required)
  -w, --watch-dir DIR      Directory containing the trigger file (default: .)
  -t, --trigger-file NAME  Trigger filename or path (default: rebuild)
  -o, --status-file FILE   Status file (default: WATCH_DIR/.compose-rebuild.status)
  -p, --poll SECONDS       Polling fallback interval (default: 2)
  -h, --help               Show this help

The trigger is removed only after a successful `up -d`. A failed trigger is
kept so it can be inspected or retried by touching it again.
EOF
}

compose_file=''
service=''
watch_dir='.'
trigger_file='rebuild'
status_file=''
poll_seconds='2'

while (($# > 0)); do
  case "$1" in
    -f|--compose-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      compose_file=$2
      shift 2
      ;;
    -s|--service)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      service=$2
      shift 2
      ;;
    -w|--watch-dir)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      watch_dir=$2
      shift 2
      ;;
    -t|--trigger-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      trigger_file=$2
      shift 2
      ;;
    -o|--status-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      status_file=$2
      shift 2
      ;;
    -p|--poll)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      poll_seconds=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$compose_file" ]] || { printf '%s\n' '--compose-file is required' >&2; usage >&2; exit 2; }
[[ -n "$service" ]] || { printf '%s\n' '--service is required to prevent project-wide lifecycle changes' >&2; usage >&2; exit 2; }
[[ -f "$compose_file" ]] || { printf 'Compose file does not exist: %s\n' "$compose_file" >&2; exit 2; }
[[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || { printf 'Invalid poll interval: %s\n' "$poll_seconds" >&2; exit 2; }

mkdir -p "$watch_dir"

if [[ "$trigger_file" = /* ]]; then
  trigger_path=$trigger_file
else
  trigger_path=$watch_dir/$trigger_file
fi

if [[ -z "$status_file" ]]; then
  status_file=$watch_dir/.compose-rebuild.status
fi

trigger_name=${trigger_path##*/}
compose_args=(-f "$compose_file")
target_args=()
if [[ -n "$service" ]]; then
  target_args=("$service")
fi

status_tmp=''
stop_requested=0

cleanup() {
  if [[ -n "$status_tmp" ]]; then
    rm -f -- "$status_tmp"
  fi
}

request_stop() {
  stop_requested=1
  printf '\nStopping after the current operation...\n' >&2
}

trap request_stop INT TERM
trap cleanup EXIT

write_status() {
  local state=$1
  local message=$2
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  status_tmp=$(mktemp "${status_file}.tmp.XXXXXX")
  {
    printf 'state=%s\n' "$state"
    printf 'message=%s\n' "$message"
    printf 'updated=%s\n' "$now"
    printf 'pid=%s\n' "$BASHPID"
    printf 'compose_file=%s\n' "$compose_file"
    printf 'service=%s\n' "$service"
    printf 'watch_dir=%s\n' "$watch_dir"
    printf 'trigger_path=%s\n' "$trigger_path"
  } >"$status_tmp"
  mv -f -- "$status_tmp" "$status_file"
  status_tmp=''
}

run_compose() {
  docker compose "${compose_args[@]}" "$@"
}

run_rebuild() {
  write_status building 'Building the requested Compose service.'
  run_compose build "${target_args[@]}" || {
    write_status failed 'Compose build failed; the trigger was retained.'
    return 1
  }

  write_status starting 'Recreating only the requested Compose service.'
  run_compose up -d --no-deps --force-recreate "${target_args[@]}" || {
    write_status failed 'Compose up failed; the trigger was retained.'
    return 1
  }

  rm -f -- "$trigger_path"
  write_status ready 'Compose rebuild completed successfully; trigger removed.'
  return 0
}

trigger_signature() {
  if [[ -e "$trigger_path" ]]; then
    stat -c '%Y:%s' -- "$trigger_path" 2>/dev/null || stat -f '%m:%z' -- "$trigger_path"
  else
    printf '%s' absent
  fi
}

process_trigger() {
  [[ -e "$trigger_path" ]] || return 0
  [[ "$stop_requested" -eq 0 ]] || return 0
  printf '[%s] Trigger detected: %s\n' "$(date -u +%FT%TZ)" "$trigger_path"
  run_rebuild || true
}

command -v docker >/dev/null 2>&1 || { printf '%s\n' 'docker is required' >&2; exit 1; }
write_status waiting 'Watching for a rebuild trigger.'
printf 'Watching %s for %s using %s.\n' "$watch_dir" "$trigger_name" "$(command -v inotifywait >/dev/null 2>&1 && printf inotify || printf polling)"

last_signature=$(trigger_signature)
process_trigger
last_signature=$(trigger_signature)

while [[ "$stop_requested" -eq 0 ]]; do
  if command -v inotifywait >/dev/null 2>&1; then
    event=$(inotifywait -q -e close_write,moved_to,create --format '%f' "$watch_dir" 2>/dev/null || true)
    [[ "$event" = "$trigger_name" ]] || continue
    process_trigger
  else
    sleep "$poll_seconds"
    current_signature=$(trigger_signature)
    if [[ "$current_signature" != "$last_signature" ]]; then
      process_trigger
      last_signature=$(trigger_signature)
    fi
  fi
done

write_status stopped 'Watcher stopped.'
