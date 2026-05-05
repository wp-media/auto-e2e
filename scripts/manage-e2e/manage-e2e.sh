#!/bin/bash
set -euo pipefail

# =============================================================================
# manage-e2e.sh — Manage PM2 E2E test processes across isolated user accounts.
#
# Usage: ./manage-e2e.sh <action> [--user <username>] [--lines <n>]
#
# Actions:
#   start    — Start E2E test process for each user
#   stop     — Stop all PM2 processes for each user
#   restart  — Restart all PM2 processes for each user
#   list     — Show PM2 process table for each user
#   status   — Alias for list
#   logs     — Print last N lines of logs (default: 20)
#   save     — Persist PM2 process list (for startup resurrection)
#   delete   — Stop and remove processes from PM2 list (confirmation required)
#   kill     — Kill the PM2 daemon entirely (confirmation required)
#   flush    — Empty all PM2 log files (confirmation required)
#
# Options:
#   --user <username>  Only target a specific user (must be in the USERS list)
#   --lines <n>        Number of log lines to show (default: 20, used with 'logs')
#
# Each user runs its own PM2 daemon with an independent E2E test instance:
#   - auto-e2e-bkwp        → BackWPup on nginx
#   - auto-e2e-bkwp-apache → BackWPup on apache
#   - auto-e2e-wpr         → WP Rocket on nginx
#   - auto-e2e-wpr-apache  → WP Rocket on apache
# =============================================================================

# --- Metadata ----------------------------------------------------------------

readonly VERSION="1.0.0"
readonly AUTHOR="Sandy Figueroa <sandy@wp-media.me>"

# --- Configuration -----------------------------------------------------------

readonly USERS=("auto-e2e-bkwp" "auto-e2e-bkwp-apache" "auto-e2e-wpr" "auto-e2e-wpr-apache")

# Actions that are safe (no confirmation needed)
readonly SAFE_ACTIONS=("start" "stop" "restart" "list" "status" "logs" "save")

# Actions that are destructive (require y/N confirmation)
readonly DESTRUCTIVE_ACTIONS=("delete" "kill" "flush")

# All allowed actions combined
readonly ALL_ACTIONS=("${SAFE_ACTIONS[@]}" "${DESTRUCTIVE_ACTIONS[@]}")

# Default log lines
LOG_LINES=20

# --- Functions ---------------------------------------------------------------

usage() {
    echo "Usage: $0 <action> [--user <username>] [--lines <n>]"
    echo ""
    echo "Actions: ${ALL_ACTIONS[*]}"
    echo ""
    echo "Options:"
    echo "  --user <username>  Target a specific user only"
    echo "  --lines <n>        Log lines to display (default: $LOG_LINES)"
    exit 1
}

# Validate that a value is in a given array.
# Usage: in_array "value" "${array[@]}"
in_array() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do
        if [[ "$item" == "$needle" ]]; then
            return 0
        fi
    done
    return 1
}

# Prompt for confirmation. Returns 0 if user confirms, 1 otherwise.
# Usage: confirm "Are you sure?"
confirm() {
    local prompt="${1:-Are you sure?}"
    local answer

    # If stdin is not a terminal (e.g., piped input), deny by default
    if [[ ! -t 0 ]]; then
        echo "Error: Destructive action requires interactive confirmation (stdin is not a terminal)." >&2
        return 1
    fi

    read -r -p "$prompt [y/N]: " answer
    case "${answer,,}" in  # ${,,} lowercases — bash 4.0+ (we have 5.2)
        y|yes) return 0 ;;
        *)     return 1 ;;
    esac
}

# Derive a unique PM2 process name from a username.
# e.g., "auto-e2e-bkwp" → "E2E-BWPUP-NGINX"
#        "auto-e2e-wpr-apache" → "E2E-WPROCKET-APACHE"
get_process_name() {
    local user="$1"
    local name

    if [[ "$user" == *"bkwp"* ]]; then
        name="E2E-BWPUP"
    else
        name="E2E-WPROCKET"
    fi

    if [[ "$user" == *"-apache"* ]]; then
        name="${name}-APACHE"
    else
        name="${name}-NGINX"
    fi

    printf '%s' "$name"
}

# Derive instance display name from a username.
# e.g., "auto-e2e-bkwp" → "BackWPup nginx"
get_instance_name() {
    local user="$1"
    local prefix server_type

    if [[ "$user" == *"bkwp"* ]]; then
        prefix="BackWPup"
    else
        prefix="WP Rocket"
    fi

    if [[ "$user" == *"-apache"* ]]; then
        server_type="apache"
    else
        server_type="nginx"
    fi

    printf '%s %s' "$prefix" "$server_type"
}

# Get the test suite argument for a user (empty string for WP Rocket).
get_suite_arg() {
    local user="$1"
    if [[ "$user" == *"bkwp"* ]]; then
        printf '%s' "test:bwpup"
    fi
    # For WP Rocket users, prints nothing (empty string)
}

# Run a pm2 command as a specific user.
#
# IMPORTANT: We use 'bash -ic' (interactive mode) to ensure .bashrc is sourced.
# On Ubuntu, .bashrc contains: case $- in *i*) ;; *) return;; esac
# This guard causes .bashrc to exit early for non-interactive shells, which
# prevents fnm/nvm from initialising and adding pm2 to PATH.
# The -i flag sets the interactive bit in $-, bypassing the guard.
# Ref: https://www.gnu.org/software/bash/manual/bash.html#index-_002di
#
# Usage: run_as_user <username> <pm2_subcommand> [args...]
run_as_user() {
    local user="$1"
    shift
    # printf '%q ' safely shell-escapes each argument.
    # Ref: bash manual — printf %q produces a string that can be reused as shell input.
    local args
    args=$(printf '%q ' "$@")
    sudo -u "$user" -i bash -ic "pm2 ${args}"
}

# --- Argument Parsing --------------------------------------------------------

ACTION=""
TARGET_USER=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --user)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --user requires a username argument." >&2
                exit 1
            fi
            TARGET_USER="$2"
            shift 2
            ;;
        --lines)
            if [[ -z "${2:-}" ]] || ! [[ "$2" =~ ^[0-9]+$ ]]; then
                echo "Error: --lines requires a positive integer argument." >&2
                exit 1
            fi
            LOG_LINES="$2"
            shift 2
            ;;
        --version|-v)
            echo ""
            echo "  e2em v${VERSION}"
            echo "  ${AUTHOR}"
            echo ""
            exit 0
            ;;
        --help|-h)
            usage
            ;;
        -*)
            echo "Error: Unknown option '$1'." >&2
            usage
            ;;
        *)
            if [[ -z "$ACTION" ]]; then
                ACTION="$1"
            else
                echo "Error: Unexpected argument '$1'." >&2
                usage
            fi
            shift
            ;;
    esac
done

if [[ -z "$ACTION" ]]; then
    usage
fi

# Validate action
if ! in_array "$ACTION" "${ALL_ACTIONS[@]}"; then
    echo "Error: Invalid action '$ACTION'." >&2
    echo "Allowed actions: ${ALL_ACTIONS[*]}" >&2
    exit 1
fi

# Validate --user if provided
if [[ -n "$TARGET_USER" ]]; then
    if ! in_array "$TARGET_USER" "${USERS[@]}"; then
        echo "Error: Unknown user '$TARGET_USER'." >&2
        echo "Valid users: ${USERS[*]}" >&2
        exit 1
    fi
fi

# Build the effective user list
if [[ -n "$TARGET_USER" ]]; then
    EFFECTIVE_USERS=("$TARGET_USER")
else
    EFFECTIVE_USERS=("${USERS[@]}")
fi

# --- Destructive Action Confirmation -----------------------------------------

if in_array "$ACTION" "${DESTRUCTIVE_ACTIONS[@]}"; then
    echo ""
    echo "WARNING: '$ACTION' is a destructive action."
    case "$ACTION" in
        delete) echo "  This will STOP and REMOVE all PM2 processes from the process list." ;;
        kill)   echo "  This will KILL the PM2 daemon entirely for each targeted user." ;;
        flush)  echo "  This will EMPTY all PM2 log files for each targeted user." ;;
    esac
    echo ""
    echo "  Targeted users: ${EFFECTIVE_USERS[*]}"
    echo ""

    if ! confirm "Proceed with '$ACTION'?"; then
        echo "Aborted."
        exit 0
    fi
    echo ""
fi

# --- Main Loop ---------------------------------------------------------------

exit_code=0

for USER in "${EFFECTIVE_USERS[@]}"; do
    echo "--------------------------------------------------------"
    echo "[$USER] Action: $ACTION"
    echo "--------------------------------------------------------"

    case "$ACTION" in
        list|status)
            if ! run_as_user "$USER" list; then
                echo "Warning: Failed to list processes for $USER" >&2
                exit_code=1
            fi
            ;;

        logs)
            # --nostream: print last N lines then exit immediately.
            # Without it, pm2 logs streams indefinitely and blocks the loop.
            # Ref: pm2 logs --help → "--nostream  print logs without launching the log stream"
            if ! run_as_user "$USER" logs --lines "$LOG_LINES" --nostream; then
                echo "Warning: Failed to fetch logs for $USER" >&2
                exit_code=1
            fi
            ;;

        save)
            if ! run_as_user "$USER" save; then
                echo "Warning: Failed to save process list for $USER" >&2
                exit_code=1
            fi
            ;;

        start)
            PROC_NAME=$(get_process_name "$USER")
            INSTANCE_NAME=$(get_instance_name "$USER")
            SUITE_ARG=$(get_suite_arg "$USER")

            # Build PM2 start command.
            #
            # Uses 'bash -ic' (same as run_as_user) so .bashrc / fnm / nvm is
            # sourced and pm2 is on PATH. See run_as_user() for full explanation.
            #
            # CRITICAL: The "script" passed to pm2 must be "node" (not the .js file).
            # The .js file goes AFTER the "--" separator as a node argument.
            # This is because xvfb-run (the interpreter) does: exec "$@"
            # (see /usr/bin/xvfb-run line ~184). If we set script=auto-e2e.js,
            # PM2 constructs: xvfb-run <args> auto-e2e.js → xvfb-run tries to
            # exec the .js file directly as a binary → "Permission denied".
            # With script=node: xvfb-run <args> node auto-e2e.js → correct.
            #
            # This matches the proven ecosystem file pattern:
            #   script: "node", args: "auto-e2e.js", interpreter: "xvfb-run"
            #
            # PM2 CLI flags verified via: pm2 --help
            #   --name <name>                  set a name for the process in the list
            #   --interpreter <interpreter>    interpreter to use (default: node)
            #   --interpreter-args <args>      arguments passed to the interpreter
            #   --restart-delay <ms>           delay between automatic restarts
            #
            # QUOTING NOTE on --interpreter-args:
            # PM2 does shell-like tokenization of the interpreter-args string.
            # Using --server-args="..." (= form) causes PM2 to store literal
            # quote characters that break xvfb-run's unquoted $XVFBARGS expansion
            # (line 165 of /usr/bin/xvfb-run: Xvfb ":$SERVERNUM" $XVFBARGS ...).
            # Using -s "..." (separate arg form) lets PM2's parser consume the
            # quotes as grouping delimiters, passing the content without literal
            # quotes. Verified via: pm2 describe → interpreter args shows three
            # clean tokens: -a, -s, -screen 0 1920x1080x24
            #
            # "cd ~/auto-e2e &&" ensures PM2 captures the correct cwd for the
            # process, so relative paths (like "auto-e2e.js") resolve correctly.
            #
            # AUTO_E2E_INSTANCE_NAME is set inline (VAR=val command) so PM2
            # captures it in the process environment at launch time.
            # Ref: https://pm2.keymetrics.io/docs/usage/environment/
            local_cmd="cd ~/auto-e2e"
            local_cmd+=" && AUTO_E2E_INSTANCE_NAME='${INSTANCE_NAME}'"
            local_cmd+=" pm2 start node"
            local_cmd+=" --name '${PROC_NAME}'"
            local_cmd+=" --interpreter xvfb-run"
            local_cmd+=" --interpreter-args '-a -s \"-screen 0 1920x1080x24\"'"
            local_cmd+=" --restart-delay 5000"
            local_cmd+=" -- auto-e2e.js"
            if [[ -n "$SUITE_ARG" ]]; then
                local_cmd+=" ${SUITE_ARG}"
            fi

            if ! sudo -u "$USER" -i bash -ic "$local_cmd"; then
                echo "Error: Failed to start process for $USER" >&2
                exit_code=1
            fi
            ;;

        stop|restart)
            # pm2 stop/restart all — affects all processes under this user's PM2.
            # Ref: pm2 stop --help → "stop <id|name|namespace|all|json|stdin...>"
            if ! run_as_user "$USER" "$ACTION" all; then
                echo "Warning: Failed to $ACTION processes for $USER" >&2
                exit_code=1
            fi
            ;;

        delete)
            # pm2 delete all — stops and removes all processes from PM2 list.
            # Ref: pm2 delete --help → "stop and delete a process from pm2 process list"
            if ! run_as_user "$USER" delete all; then
                echo "Warning: Failed to delete processes for $USER" >&2
                exit_code=1
            fi
            ;;

        kill)
            # pm2 kill — kills the PM2 daemon process entirely.
            # Ref: pm2 kill --help → "kill daemon"
            if ! run_as_user "$USER" kill; then
                echo "Warning: Failed to kill PM2 daemon for $USER" >&2
                exit_code=1
            fi
            ;;

        flush)
            # pm2 flush — empties all log files (out + error) for all processes.
            # Ref: pm2 flush --help → "flush logs"
            if ! run_as_user "$USER" flush; then
                echo "Warning: Failed to flush logs for $USER" >&2
                exit_code=1
            fi
            ;;
    esac

    echo ""
done

if [[ $exit_code -eq 0 ]]; then
    echo "Done. Action '$ACTION' completed successfully for: ${EFFECTIVE_USERS[*]}"
else
    echo "Done. Action '$ACTION' completed with warnings/errors for: ${EFFECTIVE_USERS[*]}" >&2
fi

exit $exit_code
