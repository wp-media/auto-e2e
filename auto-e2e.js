#!/usr/bin/env node

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const { time } = require('console');
const os = require('os');


const BASE_DIR = path.dirname(path.dirname(__filename));
// Simple synchronous .env loader
function loadEnv() {
  try {
    const envPath = `${BASE_DIR}/.env`;
    const envFile = fssync.readFileSync(envPath, 'utf8');
    
    envFile.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    });
  } catch (error) {
     //.env file doesn't exist or can't be read - that's okay
  }
}

// Load environment variables
loadEnv();

// Configuration
const CONFIG = {
  // Paths
  WORK_DIR: BASE_DIR,
  WP_ROCKET_CLONE_DIR: `${BASE_DIR}/wp-rocket`,
  BACKWPUP_CLONE_DIR: `${BASE_DIR}/backwpup-pro`,
  E2E_DIR: `${BASE_DIR}/wp-rocket-e2e`,
  PLUGIN_DIR: `${BASE_DIR}/wp-rocket-e2e/plugin`,
  RESULTS_DIR: `${BASE_DIR}/wp-rocket-e2e/test-results-storage`,
  
  // GitHub
  WP_ROCKET_REPO: 'https://github.com/wp-media/wp-rocket.git',
  BACKWPUP_REPO: 'https://github.com/wp-media/backwpup-pro.git',
  
  // Plugin Names
  WP_ROCKET_NAME: 'WP Rocket',
  BACKWPUP_NAME: 'BackWPUp',

  //compile script
  WP_ROCKET_COMPILE_SCRIPT: `compile-wp-rocket.sh`,
  BACKWPUP_COMPILE_SCRIPT: `compile-backwpup.sh`,
  // ZIP File after compilation
  WP_ROCKET_COMPILED_ZIP_FOLDER: `${BASE_DIR}`,
  WP_ROCKET_COMPILED_ZIP_NAME: `wp-rocket.zip`,
  BACKWPUP_COMPILED_ZIP_FOLDER:`${BASE_DIR}/backwpup-pro/`,
  BACKWPUP_COMPILED_ZIP_NAME_START: `backwpup-pro-en-`,
  // ZIP File for E2E
  WP_ROCKET_ZIP_FOR_E2E: `new_release.zip`,
  BACKWPUP_ZIP_FOR_E2E: `backwpup-pro.zip`,
  

  // Slack webhook URL - you'll need to set this up
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || '',

  // Datator API configuration
  DATATOR_API_URL: process.env.DATATOR_API_URL || 'https://datator.wp-media.me/e2e_tests/results/',
  DATATOR_API_KEY: process.env.DATATOR_API_KEY || '',

  // Timing
  LOOP_INTERVAL: 5 * 60 * 1000, // 5 minutes in milliseconds

  // Logging
  LOG_FILE: `${BASE_DIR}/auto-e2e.log`
};

class AutoE2ERunner {
  constructor() {
    this.isRunning = false;
    this.isCycleRunning = false;
  }

  async log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    
    try {
      await fs.appendFile(CONFIG.LOG_FILE, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  async executeCommand(command, cwd = CONFIG.WORK_DIR) {
    return new Promise((resolve, reject) => {
      this.log(`Executing: ${command} (in ${cwd})`);
      
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          this.log(`Command failed: ${command}`);
          this.log(`Error: ${error.message}`);
          this.log(`Stderr: ${stderr}`);
          reject(error);
        } else {
          this.log(`Command succeeded: ${command}`);
          resolve({ stdout, stderr, code: 0 });
        }
      });
    });
  }

  async checkPathExists(dir) {
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  async createDirectoryIfNeeded(dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
      this.log(`Created directory: ${dir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async cloneOrUpdatePlugin() {
    this.log(`Cloning/updating ${this.pluginName} repository...`);
    
    const exists = await this.checkPathExists(this.cloneDir);
    
    if (exists) {
      // Update existing repo
      await this.executeCommand('git fetch origin', this.cloneDir);
      await this.executeCommand('git reset --hard origin/develop', this.cloneDir); // or main/master
    } else {
      // Clone fresh
      await this.executeCommand(`git clone ${this.githubRepo} ${this.cloneDir}`);
    }
  }

  async zipPlugin() {
    try {
      if (CONFIG.WP_ROCKET_NAME === this.pluginName) {
        // Replace licence-data.php with the backup version
        this.log('Replacing licence-data.php with pre-filled version...');
        const sourceFile = path.join(CONFIG.WORK_DIR, 'licence-data.php.bak');
        const targetFile = path.join(this.cloneDir, 'licence-data.php');
        
        // Check if backup file exists
        const backupExists = await this.checkPathExists(sourceFile);
        if (!backupExists) {
          throw new Error(`Pre-filled licence file not found: ${sourceFile}`);
        }

        await this.executeCommand(`cp ${sourceFile} ${targetFile}`);
        this.log('Successfully replaced licence-data.php');
    }
    
    // Run the compile script
    this.log(`Running ${this.compileScript} script...`);
    const compileScript = path.join(CONFIG.WORK_DIR, this.compileScript);
    
    // Check if compile script exists
    const scriptExists = await this.checkPathExists(compileScript);
    if (!scriptExists) {
      throw new Error(`Compile script not found: ${compileScript}`);
    }
    
    // Make sure the script is executable
    await this.executeCommand(`chmod +x ${compileScript}`);
    
    // Run the compile script
    if (this.pluginName === CONFIG.BACKWPUP_NAME) {
      await this.executeCommand(`bash ${compileScript} --ver 5.99.99`, CONFIG.WORK_DIR);
    } else {
      await this.executeCommand(`bash ${compileScript}`, CONFIG.WORK_DIR);
    }
    
    this.log('Checking for generated ZIP file...');
    let zipPath = path.join(this.compiledZipFolder, this.compiledZipName);
    if (!fssync.existsSync(zipPath)) {
        // Find a file that starts with the compiled zip name
        const files = fssync.readdirSync(this.compiledZipFolder);
        const matchingFiles = files.filter(file => file.startsWith(this.compiledZipName));
        if (matchingFiles.length == 0) {
          throw new Error('No WP Rocket ZIP file found after compilation');
        }
        zipPath = path.join(this.compiledZipFolder, matchingFiles[0]);
    }
    
    const zipName = path.basename(zipPath);
    this.log(`Generated ZIP file: ${zipName}`);
    
    return zipPath;
    
  } catch (error) {
    this.log(`Failed to compile ${this.pluginName}: ${error.message}`);
    throw error;
  }
}

  async moveZipToPlugin(zipPath) {
    this.log('Moving ZIP to plugin directory...');
    
    await this.createDirectoryIfNeeded(CONFIG.PLUGIN_DIR);
    
    // Remove old wp-rocket zips to avoid clutter
    try {
      await this.executeCommand(`rm -f ${CONFIG.PLUGIN_DIR}/${this.zipForE2E}`);
    } catch (error) {
      this.log('No old ZIP files to remove (or removal failed)');
    }
    
    const destinationPath = path.join(CONFIG.PLUGIN_DIR, this.zipForE2E);
    await this.executeCommand(`mv ${zipPath} ${destinationPath}`);
    
    return destinationPath;
  }

  async updateE2ERepo() {
    this.log('Updating wp-rocket-e2e repository...');
    
    await this.executeCommand('git fetch origin', CONFIG.E2E_DIR);
    await this.executeCommand('git reset --hard origin/develop', CONFIG.E2E_DIR); // or master/develop
  }

  async runE2ETests(testSuite) {
    this.log(`Running E2E Tests: ${testSuite}...`);
    
    return new Promise((resolve) => {
      const process = spawn('npm', ['run', testSuite], {
        cwd: CONFIG.E2E_DIR,
        stdio: 'inherit' // This will show output in real-time
      });

       process.on('close', (code) => {
        this.log(`E2E tests ${testSuite} completed with exit code: ${code}`);
        resolve({ code });
      });

      process.on('error', (error) => {
        this.log(`E2E tests ${testSuite} process error: ${error.message}`);
        resolve({ code: 1 });
      });
    });
  }

  async sendSlackMessage(message) {
    if (!CONFIG.SLACK_WEBHOOK_URL) {
      this.log('No Slack webhook URL configured, skipping notification');
      return;
    }

    try {
      const payload = {
        text: message
      };

      await this.executeCommand(
        `curl -X POST -H 'Content-type: application/json' --data '${JSON.stringify(payload)}' ${CONFIG.SLACK_WEBHOOK_URL}`
      );

      this.log('Slack notification sent successfully');
    } catch (error) {
      this.log(`Failed to send Slack notification: ${error.message}`);
    }
  }

  async sendDataToDatator(reportAnalysis, testSuite, plugin, timestamp, gitCommit = null, duration = null) {
    if (!CONFIG.DATATOR_API_KEY) {
      this.log('No Datator API key configured, skipping data submission');
      return;
    }

    if (!reportAnalysis) {
      this.log('No report analysis data available, skipping Datator submission');
      return;
    }

    try {
      // Prepare payload for Datator
      const payload = {
        plugin: plugin,
        test_suite: testSuite,
        timestamp: timestamp,
        total_tests: reportAnalysis.totalTests,
        successful_tests: reportAnalysis.successfulTests,
        failed_tests: reportAnalysis.failedTests,
        git_commit: gitCommit,
        test_duration_seconds: duration,
        test_cases: reportAnalysis.testCases || []
      };

      // Write payload to temp file to avoid issues with special characters in curl
      const tempFile = path.join(CONFIG.WORK_DIR, '.datator-payload.json');
      await fs.writeFile(tempFile, JSON.stringify(payload));

      // Send to Datator using curl with file upload
      await this.executeCommand(
        `curl -X POST -H 'Content-Type: application/json' -H 'X-API-Key: ${CONFIG.DATATOR_API_KEY}' --data @${tempFile} ${CONFIG.DATATOR_API_URL}`
      );

      // Clean up temp file
      await fs.unlink(tempFile);

      this.log('Test results sent to Datator successfully');
    } catch (error) {
      this.log(`Failed to send data to Datator: ${error.message}`);
      // Don't fail the whole process if Datator submission fails
    }
  }

  async deleteOldTestResults() {
    // Delete test results folder older than 4 days
    this.log('Deleting old test results...');
    
    try {
      // Check if results directory exists
      const dirExists = await this.checkPathExists(CONFIG.RESULTS_DIR);
      if (!dirExists) {
        this.log('Test results storage directory does not exist, skipping cleanup');
        return;
      }

      const files = await fs.readdir(CONFIG.RESULTS_DIR);
      const now = Date.now();
      const fourDaysAgo = now - (4 * 24 * 60 * 60 * 1000); // 4 days in milliseconds
      
      let deletedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(CONFIG.RESULTS_DIR, file);
        
        try {
          const stats = await fs.stat(filePath);
          if (stats.isDirectory() && stats.mtime.getTime() < fourDaysAgo) {
            await fs.rm(filePath, { recursive: true, force: true });
            this.log(`Deleted old test result: ${file}`);
            deletedCount++;
          }
        } catch (statError) {
          this.log(`Could not process file ${file}: ${statError.message}`);
        }
      }
      
      this.log(`Old test results cleanup completed. Deleted ${deletedCount} directories.`);
    } catch (error) {
      this.log(`Failed to delete old test results: ${error.message}`);
    }
  }

  async saveTestResults() {
    this.log('Saving test results...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsDir = path.join(CONFIG.RESULTS_DIR, timestamp);
    const sourceDir = path.join(CONFIG.E2E_DIR, 'test-results');
    
    try {
      // Check if source directory exists and has content
      const sourceExists = await this.checkPathExists(sourceDir);
      if (!sourceExists) {
        this.log('No test-results directory found, skipping save');
        return;
      }

      // Create destination directory
      await this.createDirectoryIfNeeded(resultsDir);
      
      // Move files (using shell command with proper escaping)
      await this.executeCommand(`cp -r "${sourceDir}"/* "${resultsDir}"/ && rm -rf "${sourceDir}"/*`);
      
      this.log(`Test results saved to: ${resultsDir}`);
      return timestamp;
    } catch (error) {
      this.log(`Failed to save test results: ${error.message}`);
      return null;
    }
  }
 
  async configureForTestSuite(testSuite) {
    this.log(`Configuring for test suite: ${testSuite}`);
    // Identify which plugin is being tested
    let pluginUnderTest = CONFIG.WP_ROCKET_NAME;
    if (testSuite.startsWith('test:bwpup')) {
      pluginUnderTest = CONFIG.BACKWPUP_NAME;
    }

    switch (pluginUnderTest) {
      default:
      case CONFIG.WP_ROCKET_NAME:
        this.log(`Configuring for ${CONFIG.WP_ROCKET_NAME} tests...`);
        this.cloneDir = CONFIG.WP_ROCKET_CLONE_DIR;
        this.githubRepo = CONFIG.WP_ROCKET_REPO;
        this.pluginName = CONFIG.WP_ROCKET_NAME;
        this.compileScript = CONFIG.WP_ROCKET_COMPILE_SCRIPT;
        this.compiledZipFolder = CONFIG.WP_ROCKET_COMPILED_ZIP_FOLDER;
        this.compiledZipName = CONFIG.WP_ROCKET_COMPILED_ZIP_NAME;
        this.zipForE2E = CONFIG.WP_ROCKET_ZIP_FOR_E2E;
        break;
      case CONFIG.BACKWPUP_NAME:
        this.log(`Configuring for ${CONFIG.BACKWPUP_NAME} tests...`);
        this.cloneDir = CONFIG.BACKWPUP_CLONE_DIR;
        this.githubRepo = CONFIG.BACKWPUP_REPO;
        this.pluginName = CONFIG.BACKWPUP_NAME;
        this.compileScript = CONFIG.BACKWPUP_COMPILE_SCRIPT;
        this.compiledZipFolder = CONFIG.BACKWPUP_COMPILED_ZIP_FOLDER;
        this.compiledZipName = CONFIG.BACKWPUP_COMPILED_ZIP_NAME_START;
        this.zipForE2E = CONFIG.BACKWPUP_ZIP_FOR_E2E;
        break;
    }
  }

  async runCycle(testSuite) {
    if (this.isCycleRunning) {
      this.log('Previous cycle still running, skipping this interval...');
      return;
    }
    this.isCycleRunning = true; // Set flag

    try{

      const cycleStart = new Date();
      this.log(`Starting new cycle at ${cycleStart.toISOString()}`);
    
      // Configure for the specific test suite
      await this.configureForTestSuite(testSuite);

      // Step 1: Clone/update the plugin
      await this.cloneOrUpdatePlugin();
      
      // Step 2: Create ZIP
      const zipPath = await this.zipPlugin();
      
      // Step 3: Move ZIP to plugin directory
      await this.moveZipToPlugin(zipPath);
      
      // Step 4: Update E2E repo
      await this.updateE2ERepo();
      
      // Step 5: Run the test suite
      const result = await this.runE2ETests(testSuite);
      
      // Step 6: Maintain test results
      await this.deleteOldTestResults();
      const resultTimestamp = await this.saveTestResults();

      // Step 7: Analyze report and send notification if needed
      //Analyze cucumber report using analyzeCucumberReport
      const jsonReportPath = path.join(CONFIG.RESULTS_DIR, resultTimestamp, 'cucumber-report.json');
      const reportAnalysis = await this.analyzeCucumberReport(jsonReportPath);
      
      let slackMessage = '';
      if (reportAnalysis.failedTests === 0 && reportAnalysis.successfulTests > 0) {
        this.log(`✅ E2E tests ${testSuite} passed successfully`);
        slackMessage = `✅ Auto E2E tests ${testSuite} Ran Successfully!`;
        slackMessage += `\n\nNumber of successful tests: ${reportAnalysis.successfulTests}`;
      } else {
        this.log(`❌ E2E tests ${testSuite} failed`);
        slackMessage = `❌ Auto E2E tests ${testSuite} Failed!`;
        slackMessage += `\n\nNumber of failed tests: ${reportAnalysis.failedTests}`;
        slackMessage += `\n\nFailed tests:\n${reportAnalysis.failedTestNames.join('\n')}`;
      }
      // Add SCP download command if results were saved to facilitate downloading
      if (resultTimestamp) {
        const username = os.userInfo().username;
        slackMessage += `\n\nDownload test report:\n\`\`\`scp ${username}@xx.xx.xx.xx:~/wp-rocket-e2e/test-results-storage/${resultTimestamp}/cucumber-report.html ${resultTimestamp}.html\`\`\``;
      }
      slackMessage = slackMessage.replace(/'/g, "'\\''");
      await this.sendSlackMessage(slackMessage);

      // Step 8: Send data to Datator
      // Map plugin name to plugin code for Datator
      const pluginCode = this.pluginName === CONFIG.WP_ROCKET_NAME ? 'wp_rocket' : 'backwpup';

      // Get git commit hash from the plugin directory
      let gitCommit = null;
      try {
        const gitHashCommand = `cd ${this.cloneDir} && git rev-parse HEAD`;
        const gitHashResult = await this.executeCommand(gitHashCommand);
        gitCommit = gitHashResult.stdout ? gitHashResult.stdout.trim() : null;
      } catch (error) {
        this.log(`Could not get git commit hash: ${error.message}`);
      }

      const cycleEnd = new Date();
      const durationMs = cycleEnd - cycleStart;
      const durationSeconds = Math.floor(durationMs / 1000);

      // Send to Datator with ISO timestamp
      await this.sendDataToDatator(
        reportAnalysis,
        testSuite,
        pluginCode,
        cycleStart.toISOString(),
        gitCommit,
        durationSeconds
      );

      this.log(`Cycle completed in ${durationMs}ms`);

    } catch (error) {
      this.log(`❌ Cycle failed with error: ${error.message}`);
      const errorMessage = `❌ Auto E2E Script Error!`;
      await this.sendSlackMessage(errorMessage);

    } finally {
      this.isCycleRunning = false; // Reset flag
    }
  }

  async start(testSuite) {
    if (this.isRunning) {
      this.log('Auto E2E is already running');
      return;
    }

    this.isRunning = true;
    this.log(`🚀 Starting Auto E2E for ${testSuite}...`);
    
    // Validate configuration
    if (!await this.checkPathExists(CONFIG.E2E_DIR)) {
      throw new Error(`E2E directory does not exist: ${CONFIG.E2E_DIR}`);
    }

    // Run first cycle immediately
    await this.runCycle(testSuite);
    
    // Set up recurring cycles
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runCycle(testSuite);
      }
    }, CONFIG.LOOP_INTERVAL);
    
    this.log(`Monitor started. Running every ${CONFIG.LOOP_INTERVAL / 1000} seconds.`);
  }

  async stop() {
    this.log('Stopping Auto E2E...');
    this.isRunning = false;
    this.isCycleRunning = false; // Reset cycle flag
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async analyzeCucumberReport(filePath) {
    try {
        // Read and parse the JSON file
        const jsonData = fssync.readFileSync(filePath, 'utf8');
        const report = JSON.parse(jsonData);

        let successfulTests = 0;
        let failedTests = 0;
        const failedTestNames = [];
        const testCases = []; // Array to store individual test case details

        console.log('=== CUCUMBER TEST REPORT ANALYSIS ===');
        console.log(`Found ${report.length} feature(s)\n`);

        // Iterate through each feature
        report.forEach((feature) => {
            // Check if feature has elements (scenarios)
            if (!feature.elements || !Array.isArray(feature.elements)) {
                return;
            }

            const featureName = feature.name || 'Unnamed Feature';

            // Iterate through each scenario in the feature
            feature.elements.forEach(scenario => {
                // Skip background steps (they're not actual tests)
                if (scenario.type === 'background') {
                    return;
                }

                const testName = scenario.name || scenario.id || 'Unnamed Test';
                const fullTestName = `${featureName} - ${testName}`;

                // Check if all steps in the scenario passed
                let testPassed = true;
                let totalSteps = 0;
                let passedSteps = 0;
                let failedSteps = 0;
                let skippedSteps = 0;
                let errorMessage = null;

                if (scenario.steps && Array.isArray(scenario.steps)) {
                    scenario.steps.forEach(step => {
                        totalSteps++;

                        if (step.result && step.result.status) {
                            switch (step.result.status) {
                                case 'passed':
                                    passedSteps++;
                                    break;
                                case 'failed':
                                    failedSteps++;
                                    testPassed = false;
                                    // Capture error message from first failed step
                                    if (!errorMessage && step.result.error_message) {
                                        errorMessage = step.result.error_message;
                                    }
                                    break;
                                case 'skipped':
                                    skippedSteps++;
                                    testPassed = false;
                                    break;
                                default:
                                    // undefined, pending, etc.
                                    testPassed = false;
                                    break;
                            }
                        } else {
                            // No result means the step didn't run properly
                            testPassed = false;
                        }
                    });
                }

                // Determine status
                const status = testPassed && totalSteps > 0 ? 'passed' :
                              (failedSteps > 0 ? 'failed' : 'skipped');

                // Add test case details
                testCases.push({
                    feature_name: featureName,
                    test_name: testName,
                    status: status,
                    error_message: errorMessage
                });

                // Count and categorize the test
                if (testPassed && totalSteps > 0) {
                    successfulTests++;
                } else {
                    failedTests++;
                    failedTestNames.push(fullTestName);
                    console.log(`  ❌ ${testName} (${passedSteps} passed, ${failedSteps} failed, ${skippedSteps} skipped)`);
                }
            });
        });

        // Display final results
        console.log('\n=== FINAL RESULTS ===');
        console.log(`Total Tests: ${successfulTests + failedTests}`);
        console.log(`Successful Tests: ${successfulTests}`);
        console.log(`Failed Tests: ${failedTests}`);
        console.log('');

        if (failedTestNames.length > 0) {
            console.log('=== FAILED TESTS ===');
            failedTestNames.forEach((testName, index) => {
                console.log(`${index + 1}. ${testName}`);
            });
        } else {
            console.log('🎉 All tests passed!');
        }

        return {
            totalTests: successfulTests + failedTests,
            successfulTests,
            failedTests,
            failedTestNames,
            testCases // Include detailed test case data
        };

    } catch (error) {
        console.error('Error analyzing cucumber report:', error.message);

        if (error.message.includes('JSON')) {
            console.error('Make sure the file is valid JSON format');
        } else if (error.code === 'ENOENT') {
            console.error('File not found. Check the file path.');
        }

        return null;
    }
  }
}

// Handle process termination gracefully
const monitor = new AutoE2ERunner();

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  await monitor.stop();
  process.exit(0);
});

// Start the monitor
const testSuite = process.argv[2] || 'test:e2e';
monitor.start(testSuite).catch((error) => {
  console.error('Failed to start monitor:', error.message);
  process.exit(1);
});