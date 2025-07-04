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
- Wait a few minutes before starting another run.

**How to run**

1. Clone the repository on the dedicated test environment.
2. Ensure the configuration (CONFIG constant) matches the test environment folder structure and settings.
3. Copy .env.example to .env and set the environment variables.
4. Connect to the environment through a VNC server, open the terminal, navigate to the auto-e2e folder and run `node auto-e2e.js`