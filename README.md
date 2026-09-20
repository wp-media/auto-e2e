**Context**

This repository contains a script that runs [rocket-e2e](https://github.com/wp-media/wp-rocket-e2e) automatically and regularly. The script is designed to run on dedicated test environments ([see WP Media internal documentation](https://www.notion.so/wpmedia/auto-e2e-servers-217ed22a22f0808ea044ce092c342a54?source=copy_link)).

**What the script does**

The script runs the following loop, until being stopped:
- Clone or update the plugin from its git `develop` branch, package it as `new_release.zip`, and move it to its expected location for rocket-e2e.
- Clean build artifacts (`git clean -fdx`), then clone or update the same plugin from its git `trunk` branch, package it as `previous_stable.zip`, and move it alongside `new_release.zip`. This gives rocket-e2e's upgrade-testing scenarios (e.g. `upgrading-plugin.feature`) a fresh "previous stable" build to upgrade from on every cycle.
- Update the rocket-e2e repo to the latest git develop branch.
- Update WordPress core (and run any pending DB migrations) on the remote test site via WP-CLI over SSH, before running tests. Non-fatal: if the update fails, the cycle logs the error and continues. Can be disabled by setting `UPDATE_WORDPRESS=false`.
- Run rocket-e2e (with specific options)
- Copy & Rename the `wp-rocket-e2e/test-results` folder in `wp-rocket-e2e/test-results-storage`. Results older than 7 days are deleted **only if all their tests passed**; results with failing or unanalyzable reports are kept indefinitely so they remain available for investigation.
- Logs & sends to Slack the result of the run (#wpmedia_auto-e2e-reports)
- Sends test results data to Datator for analytics and dashboard generation
- Wait a few minutes before starting another run.

**How to run**

1. Clone the repository on the dedicated test environment.
2. Ensure the configuration (CONFIG constant) matches the test environment folder structure and settings.
3. Copy .env.example to .env and set the environment variables.
4. Connect to the environment through a VNC server, open the terminal, navigate to the auto-e2e folder and run `node auto-e2e.js`

**Environment Configuration**

The following environment variables should be configured in your `.env` file:

- `SLACK_WEBHOOK_URL`: Slack webhook URL for sending test notifications (required for Slack notifications)
- `DATATOR_API_KEY`: API key for authenticating with Datator (required for sending test data to Datator)
- `DATATOR_API_URL`: (Optional) Override the default Datator API endpoint. Defaults to `https://datator.wp-media.me/e2e_tests/results/`
- `UPDATE_WORDPRESS`: (Optional) Set to `false` to disable the automatic `wp core update` / `wp core update-db` step run on the remote test site before each cycle's tests. Defaults to `true` (enabled) when unset.
Slack reports also include the WordPress and PHP versions of the remote test site, fetched over SSH via WP-CLI. No extra configuration is needed for this: the SSH connection details (`WP_SSH_ADDRESS`, `WP_SSH_USERNAME`, `WP_SSH_KEY`, `WP_SSH_ROOT_DIR`) are read directly from `wp-rocket-e2e/config/wp.config.ts`, which already defines them. Requires WP-CLI (`wp`) to be installed on the remote test site; if the config file or WP-CLI is unavailable, this line is simply omitted from the report.

The following environment variable can be configured in your `.env`, but it is recommended to set it inline when running the script to set the name dynamically:

- `AUTO_E2E_INSTANCE_NAME`: Optional identifier that prefixes Slack notifications (e.g., "BackWPup Apache", "WP Rocket Server 1")

Example:

```bash
AUTO_E2E_INSTANCE_NAME="BackWPup Apache" node auto-e2e.js
```

**Setting up the Datator API Key**

The `DATATOR_API_KEY` must match the `E2E_TESTS_API_KEY` configured in the Datator environment.

To set up the API key on your auto-e2e server:

1. **Option 1: Using .env file (Recommended)**
   - Copy `.env.example` to `.env`
   - Set `DATATOR_API_KEY=your-secret-key-here`

2. **Option 2: Using system environment variable**
   - Add to your shell profile (e.g., `~/.bashrc` or `~/.zshrc`):
     ```bash
     export DATATOR_API_KEY="your-secret-key-here"
     ```

**Important Security Notes:**
- The API key should **never** be committed to the repository
- The `.env` file is gitignored to prevent accidental commits
- Each auto-e2e server needs its own `.env` file with the API key configured
- Contact a Datator administrator to obtain the API key value