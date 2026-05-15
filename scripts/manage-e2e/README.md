# e2em

A single command to manage all E2E test instances.

Each instance runs under its own Linux user with its own PM2 daemon, Node.js (via fnm), and headless browser (via xvfb-run). This script lets you start, stop, inspect, and manage all of them at once — or target one specific instance.

---

## Installation

The `e2em` command should already be installed and available globally on the remote desktop server. If you need to install it for the first time or update it after a change:

```bash
# From the auto-e2e repository root:
sudo cp scripts/manage-e2e/manage-e2e.sh /usr/local/bin/e2em
sudo chown root:root /usr/local/bin/e2em
sudo chmod 755 /usr/local/bin/e2em
```

Verify it works:

```bash
e2em --help
```

> `/usr/local/bin` is the standard location for locally-installed commands available to all users on the system ([FHS §4.9](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch04s09.html)).

---

## Instances

| PM2 Process Name | Linux User | Test Suite | Web Server |
|---|---|---|---|
| `E2E-BWPUP-NGINX` | `auto-e2e-bkwp` | BackWPup | nginx |
| `E2E-BWPUP-APACHE` | `auto-e2e-bkwp-apache` | BackWPup | apache |
| `E2E-WPROCKET-NGINX` | `auto-e2e-wpr` | WP Rocket | nginx |
| `E2E-WPROCKET-APACHE` | `auto-e2e-wpr-apache` | WP Rocket | apache |

---

## Quick Start

```bash
# Start all E2E test instances
e2em start

# Check if everything is running
e2em list

# View recent logs from all instances
e2em logs

# Stop everything
e2em stop

# Restart everything
e2em restart
```

---

## Basic Usage

```bash
e2em <action> [--user <username>] [--lines <n>]
```

### Most Common Commands

```bash
# Start all instances (each one launches its own virtual display + browser)
e2em start

# See what's running (shows PM2 process table for each user)
e2em list

# View the last 20 lines of logs for all instances
e2em logs

# View more log history (last 100 lines)
e2em logs --lines 100

# Stop all running tests
e2em stop

# Restart all tests (stop + start)
e2em restart

# Target only one specific instance
e2em logs --user auto-e2e-wpr
e2em restart --user auto-e2e-bkwp-apache
```

---

## Full Command Reference

### Safe Actions (no confirmation needed)

| Command | Description |
|---|---|
| `start` | Starts the E2E test process for each user. Launches PM2 with xvfb-run + node. |
| `stop` | Stops all PM2 processes for each user. Processes remain in the PM2 list (can be restarted). |
| `restart` | Restarts all PM2 processes for each user. Equivalent to stop + start without losing the process config. |
| `list` | Shows the PM2 process table (name, status, uptime, restarts, CPU, memory) for each user. |
| `status` | Alias for `list`. Identical behavior. |
| `logs` | Prints the last N lines of logs for each user and exits. Does NOT tail/follow. Default: 20 lines. |
| `save` | Persists the current PM2 process list to disk so processes auto-start on server reboot (requires `pm2 startup` to be configured). |

### Destructive Actions (require interactive y/N confirmation)

| Command | Description |
|---|---|
| `delete` | Stops all processes AND removes them from the PM2 process list entirely. You'll need to `start` again to re-create them. |
| `kill` | Kills the PM2 daemon itself for each user. All processes stop. The daemon restarts automatically on next PM2 command. |
| `flush` | Empties all PM2 log files (both stdout and stderr logs) for each user. Useful to free disk space. |

> Destructive actions cannot be confirmed via piped input or scripts. They require an interactive terminal.

---

## Options

### `--user <username>`

Target a single user instead of all four. Must be one of:

- `auto-e2e-bkwp`
- `auto-e2e-bkwp-apache`
- `auto-e2e-wpr`
- `auto-e2e-wpr-apache`

```bash
# Only start the WP Rocket nginx instance
e2em start --user auto-e2e-wpr

# Only check logs for BackWPup apache
e2em logs --user auto-e2e-bkwp-apache

# Only restart WP Rocket apache
e2em restart --user auto-e2e-wpr-apache
```

### `--lines <n>`

Set the number of log lines to display. Only applies to the `logs` action. Default is 20.

```bash
# Show last 50 lines for all users
e2em logs --lines 50

# Show last 200 lines for one user
e2em logs --user auto-e2e-wpr --lines 200
```

### `--version` / `-v`

Display the current version of `e2em` and exit.

### `--help` / `-h`

Show usage information and exit.

```bash
e2em --help
```

---

## All Commands (Copy-Paste Reference)

```bash
e2em start                          # Start all instances
e2em stop                           # Stop all instances
e2em restart                        # Restart all instances
e2em list                           # Show PM2 process table for all
e2em status                         # Same as list
e2em logs                           # Last 20 log lines for all
e2em logs --lines 50                # Last 50 log lines for all
e2em save                           # Persist process list for auto-restart on reboot
e2em delete                         # Remove all processes from PM2 (asks y/N)
e2em kill                           # Kill PM2 daemon for all users (asks y/N)
e2em flush                          # Empty all log files (asks y/N)

e2em start --user auto-e2e-wpr      # Start only WP Rocket nginx
e2em stop --user auto-e2e-bkwp      # Stop only BackWPup nginx
e2em logs --user auto-e2e-wpr-apache --lines 100  # 100 log lines for one user
```

---

## How It Works

### Architecture

```
e2em (runs as root or sudoer)
│
├── sudo -u auto-e2e-bkwp -i bash -ic "..."
│   └── PM2 daemon → xvfb-run → node auto-e2e.js test:bwpup
│       └── Xvfb virtual display :99 (1920x1080x24)
│           └── Chromium (Playwright) → BackWPup E2E tests on nginx
│
├── sudo -u auto-e2e-bkwp-apache -i bash -ic "..."
│   └── PM2 daemon → xvfb-run → node auto-e2e.js test:bwpup
│       └── Xvfb virtual display :99 (1920x1080x24)
│           └── Chromium (Playwright) → BackWPup E2E tests on apache
│
├── sudo -u auto-e2e-wpr -i bash -ic "..."
│   └── PM2 daemon → xvfb-run → node auto-e2e.js test:e2e
│       └── Xvfb virtual display :99 (1920x1080x24)
│           └── Chromium (Playwright) → WP Rocket E2E tests on nginx
│
└── sudo -u auto-e2e-wpr-apache -i bash -ic "..."
    └── PM2 daemon → xvfb-run → node auto-e2e.js test:e2e
        └── Xvfb virtual display :99 (1920x1080x24)
            └── Chromium (Playwright) → WP Rocket E2E tests on apache
```

### Process Chain Explained

When you run `e2em start`, this is what happens for each user:

1. **`sudo -u <user> -i bash -ic "..."`** — Switches to the target user with a login shell (`-i`), then runs an interactive bash (`bash -ic`) so `.bashrc` is fully sourced (required for fnm/Node.js PATH setup).

2. **`cd ~/auto-e2e`** — Changes to the user's `auto-e2e` directory so PM2 records the correct working directory.

3. **`AUTO_E2E_INSTANCE_NAME='...' pm2 start node`** — Starts PM2 with an environment variable identifying the instance, running `node` as the script.

4. **`--interpreter xvfb-run`** — Tells PM2 to wrap the script (node) with `xvfb-run`, which creates a virtual X display before executing the command.

5. **`--interpreter-args '-a -s "-screen 0 1920x1080x24"'`** — Passes arguments to xvfb-run: `-a` (auto-pick display number), `-s` (server args for Xvfb with 1920×1080 resolution at 24-bit color depth).

6. **`-- auto-e2e.js [test:bwpup]`** — After the `--` separator, these become arguments to `node`: the script file and optionally the test suite name.

The resulting runtime command becomes:
```
xvfb-run -a -s "-screen 0 1920x1080x24" node auto-e2e.js [test:bwpup]
```

### Why `bash -ic` (Interactive Mode)?

Ubuntu's default `~/.bashrc` starts with:

```bash
case $- in
    *i*) ;;
      *) return;;
esac
```

This exits `.bashrc` early for non-interactive shells. Since all users have Node.js managed by **fnm** (Fast Node Manager), which initializes in `.bashrc`, a non-interactive shell won't have `pm2` on PATH. The `-i` flag forces bash into interactive mode, bypassing the guard and ensuring fnm sets up the correct Node.js and `pm2` paths.

### Why `pm2 start node` (Not `pm2 start auto-e2e.js`)?

When PM2 uses an interpreter, it constructs the command as:

```
<interpreter> <interpreter-args> <script> <script-args>
```

If the script is `auto-e2e.js`, PM2 builds: `xvfb-run ... auto-e2e.js` → xvfb-run tries to `exec` the `.js` file directly as a binary → "Permission denied".

With `node` as the script: `xvfb-run ... node auto-e2e.js` → xvfb-run execs `node` (a proper binary) which interprets the `.js` file → works correctly.

### Why `-s` Instead of `--server-args=`?

PM2 does shell-like tokenization of `--interpreter-args`. The `--server-args="..."` form (with `=`) causes PM2 to store literal quote characters in the value. When xvfb-run later does `Xvfb ":$SERVERNUM" $XVFBARGS` (unquoted expansion), those literal quotes break the argument into wrong tokens.

Using `-s "..."` (short form, separate argument) lets PM2's parser consume the `"..."` as grouping delimiters, passing clean content without literal quote characters. This was verified with `pm2 describe` showing three correct tokens: `-a`, `-s`, `-screen 0 1920x1080x24`.

---

## Error Handling

- **Per-user failures don't abort the loop.** If one user's command fails, the script logs a warning to stderr and continues with the remaining users. The exit code reflects whether any failures occurred.

- **Exit codes:**
  - `0` — All commands succeeded for all targeted users.
  - `1` — One or more commands failed (warnings printed to stderr).

- **Input validation:**
  - Actions are validated against a whitelist. Unknown actions are rejected.
  - `--user` values are validated against the configured user list.
  - `--lines` must be a positive integer.
  - Unknown options are rejected with a usage hint.

- **Destructive action safety:**
  - `delete`, `kill`, and `flush` require typing `y` or `yes` at an interactive prompt.
  - If stdin is not a terminal (piped input, scripts, cron), destructive actions are automatically denied.

---

## Environment Variables

| Variable | Set By | Purpose |
|---|---|---|
| `AUTO_E2E_INSTANCE_NAME` | This script (at start time) | Identifies the instance in logs and Slack notifications (e.g., "WP Rocket nginx", "BackWPup apache") |

---

## Prerequisites

- **Root or sudo access** — The script uses `sudo -u <user>` to switch between users.
- **PM2** — Installed globally via npm for each user (managed by fnm).
- **fnm** — Fast Node Manager, configured in each user's `~/.bashrc`.
- **xvfb-run** — Provides virtual X display for headless Chromium (`apt install xvfb`).
- **Playwright + Chromium** — Installed in each user's test project for browser automation.
- **bash 4.0+** — Required for `${var,,}` lowercase syntax (servers usually runs bash 5.2, so this is okay).

---

## File Locations

| What | Path |
|---|---|
| Script source (this repo) | `scripts/manage-e2e/manage-e2e.sh` |
| Installed command | `/usr/local/bin/e2em` |
| Test runner (per user) | `~/auto-e2e/auto-e2e.js` |
| PM2 daemon home (per user) | `~/.pm2/` |
| PM2 logs (per user) | `~/.pm2/logs/` |
| PM2 process dump (per user) | `~/.pm2/dump.pm2` |
| Node.js (per user, via fnm) | `~/.local/share/fnm/node-versions/` |

> `~` in the table above refers to each E2E user's home directory (e.g., `/home/auto-e2e-wpr/`).

---

## Troubleshooting

### `pm2: command not found`

The script already handles this by using `bash -ic`. If you still see this error, check that fnm is properly configured in the user's `~/.bashrc`.

### `Permission denied` on `.js` file

This means the PM2 start command is using the `.js` file as the script instead of `node`. The correct pattern is `pm2 start node ... -- auto-e2e.js`. This script already uses the correct pattern.

### `Missing X server or $DISPLAY`

This means xvfb-run isn't creating the virtual display properly. Usually a quoting issue with `--interpreter-args`. The script uses the correct `-s "..."` form. If you see this after a manual edit, verify with:

```bash
sudo -u auto-e2e-wpr -i bash -ic "pm2 describe E2E-WPROCKET-NGINX" | grep "interpreter"
```

The interpreter args should show: `-a`, `-s`, `-screen 0 1920x1080x24` (three clean tokens, no literal quotes).

### Process keeps restarting (crash loop)

Check logs for the specific user:

```bash
e2em logs --user auto-e2e-wpr --lines 50
```

Common causes: missing dependencies, network issues, test environment not ready.

### Destructive action won't confirm

Destructive actions (`delete`, `kill`, `flush`) require an interactive terminal. They cannot be run from cron, piped scripts, or non-TTY contexts. This is intentional for safety.

---

## Technical References

| Topic | Source |
|---|---|
| PM2 Process Management | [pm2.keymetrics.io/docs/usage/quick-start](https://pm2.keymetrics.io/docs/usage/quick-start/) |
| PM2 Environment Variables | [pm2.keymetrics.io/docs/usage/environment](https://pm2.keymetrics.io/docs/usage/environment/) |
| PM2 Interpreter & Args | `pm2 --help` (flags: `--interpreter`, `--interpreter-args`, `--restart-delay`) |
| PM2 Logs `--nostream` | `pm2 logs --help` → "print logs without launching the log stream" |
| PM2 Flush | `pm2 flush --help` → "flush logs" |
| PM2 Kill | `pm2 kill --help` → "kill daemon" |
| Bash Interactive Mode (`-i`) | [GNU Bash Manual §6.3.2](https://www.gnu.org/software/bash/manual/bash.html#index-_002di) |
| Bash `printf %q` | [GNU Bash Manual — printf](https://www.gnu.org/software/bash/manual/bash.html#index-printf) |
| Bash `${var,,}` lowercase | [GNU Bash Manual §3.5.3 — Shell Parameter Expansion](https://www.gnu.org/software/bash/manual/bash.html#Shell-Parameter-Expansion) (bash 4.0+) |
| xvfb-run | `man xvfb-run` — `-a` auto-select display, `-s` server args |
| Ubuntu .bashrc guard | `/etc/skel/.bashrc` — `case $- in *i*) ;; *) return;; esac` |
| `[[ -t 0 ]]` TTY check | [GNU Bash Manual §6.4 — Conditional Expressions](https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions) |
