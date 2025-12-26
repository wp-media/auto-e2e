**Context**

This repository contains a script that runs [rocket-e2e](https://github.com/wp-media/wp-rocket-e2e) automatically and regularly. The script is designed to run on dedicated test environments ([see WP Media internal documentation](https://www.notion.so/wpmedia/auto-e2e-servers-217ed22a22f0808ea044ce092c342a54?source=copy_link)).

**What the script does**

The script runs the following loop, until being stopped:
- Clone or Update WP Rocket from git develop branch
- Package the develop version of WP Rocket in a zip file.
- Move the zip file to its expected location by rocket-e2e
- Update the rocket-e2e repo to the latest git develop branch.
- Run rocket-e2e (with specific options)
- Copy & Rename the `wp-rocket-e2e/test-results` folder in `wp-rocket-e2e/test-results-storage`. Results are stored for 4 days.
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