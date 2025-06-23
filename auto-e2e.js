#!/usr/bin/env node

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');


const BASE_DIR = '/home/ubuntu';
// Simple synchronous .env loader
function loadEnv() {
  try {
    const envPath = `${BASE_DIR}/auto-e2e/.env`;
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
  E2E_DIR: `${BASE_DIR}/wp-rocket-e2e`,
  PLUGIN_DIR: `${BASE_DIR}/wp-rocket-e2e/plugin`,
  RESULTS_DIR: `${BASE_DIR}/wp-rocket-e2e/test-results-storage`,
  
  // GitHub
  WP_ROCKET_REPO: 'https://github.com/wp-media/wp-rocket.git', // Update with actual repo URL
  
  // Slack webhook URL - you'll need to set this up
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || '',
  
  // Timing
  LOOP_INTERVAL: 5 * 60 * 1000, // 5 minutes in milliseconds
  
  // Logging
  LOG_FILE: '/home/ubuntu/wp-rocket-monitor.log'
};

class WPRocketMonitor {
  constructor() {
    this.isRunning = false;
    this.isTestRunning = false;
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

  async cloneOrUpdateWPRocket() {
    this.log('Cloning/updating WP Rocket repository...');
    
    const exists = await this.checkPathExists(CONFIG.WP_ROCKET_CLONE_DIR);
    
    if (exists) {
      // Update existing repo
      await this.executeCommand('git fetch origin', CONFIG.WP_ROCKET_CLONE_DIR);
      await this.executeCommand('git reset --hard origin/develop', CONFIG.WP_ROCKET_CLONE_DIR); // or main/master
    } else {
      // Clone fresh
      await this.executeCommand(`git clone ${CONFIG.WP_ROCKET_REPO} ${CONFIG.WP_ROCKET_CLONE_DIR}`);
    }
  }

  async zipWPRocket() {
    try {
      // Replace licence-data.php with the backup version
      this.log('Replacing licence-data.php with pre-filled version...');
      const sourceFile = path.join(CONFIG.WORK_DIR, 'licence-data.php.bak');
      const targetFile = path.join(CONFIG.WP_ROCKET_CLONE_DIR, 'licence-data.php');
      
      // Check if backup file exists
      const backupExists = await this.checkPathExists(sourceFile);
      if (!backupExists) {
        throw new Error(`Pre-filled licence file not found: ${sourceFile}`);
      }

    await this.executeCommand(`cp ${sourceFile} ${targetFile}`);
    this.log('Successfully replaced licence-data.php');
    
    // Run the compile script
    this.log('Running compile-wp-rocket.sh script...');
    const compileScript = path.join(CONFIG.WORK_DIR, 'compile-wp-rocket.sh');
    
    // Check if compile script exists
    const scriptExists = await this.checkPathExists(compileScript);
    if (!scriptExists) {
      throw new Error(`Compile script not found: ${compileScript}`);
    }
    
    // Make sure the script is executable
    await this.executeCommand(`chmod +x ${compileScript}`);
    
    // Run the compile script
    await this.executeCommand(`bash ${compileScript}`, CONFIG.WORK_DIR);
    
    this.log('Checking for generated ZIP file...');
    const zipPath = path.join(CONFIG.WORK_DIR, 'wp-rocket.zip');
    if (!zipPath) {
        throw new Error('No WP Rocket ZIP file found after compilation');
    }
    
    const zipName = path.basename(zipPath);
    this.log(`Generated ZIP file: ${zipName}`);
    
    return zipPath;
    
  } catch (error) {
    this.log(`Failed to compile WP Rocket: ${error.message}`);
    throw error;
  }
}

  async moveZipToPlugin(zipPath) {
    this.log('Moving ZIP to plugin directory...');
    
    await this.createDirectoryIfNeeded(CONFIG.PLUGIN_DIR);
    
    // Remove old wp-rocket zips to avoid clutter
    try {
      await this.executeCommand(`rm -f ${CONFIG.PLUGIN_DIR}/new_release.zip`);
    } catch (error) {
      this.log('No old ZIP files to remove (or removal failed)');
    }
    
    const destinationPath = path.join(CONFIG.PLUGIN_DIR, 'new_release.zip');
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
  } catch (error) {
    this.log(`Failed to save test results: ${error.message}`);
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
    
      // Step 1: Clone/update WP Rocket
      await this.cloneOrUpdateWPRocket();
      
      // Step 2: Create ZIP
      const zipPath = await this.zipWPRocket();
      
      // Step 3: Move ZIP to plugin directory
      await this.moveZipToPlugin(zipPath);
      
      // Step 4: Update E2E repo
      await this.updateE2ERepo();
      
      // Step 5: Run the test suite
      const result = await this.runE2ETests(testSuite);
      
      // Step 6: Check exit code and send notification if needed
      var errorMessage = '';
      if (result.code === 0) {
        this.log(`✅ E2E tests ${testSuite} passed successfully`);
        errorMessage = `✅ WP Rocket E2E tests ${testSuite} Ran Successfully!`;
      } else {
        this.log(`❌ E2E tests ${testSuite} failed`);
        errorMessage = `❌ WP Rocket E2E tests ${testSuite} Failed!`;
      }
      await this.sendSlackMessage(errorMessage);
      
      // Step 7: Maintain test results
      await this.deleteOldTestResults();
      await this.saveTestResults();

      const cycleEnd = new Date();
      const duration = cycleEnd - cycleStart;
      this.log(`Cycle completed in ${duration}ms`);

    } catch (error) {
      this.log(`❌ Cycle failed with error: ${error.message}`);
      const errorMessage = `❌ WP Rocket Monitor Script Error!`;
      await this.sendSlackMessage(errorMessage);

    } finally {
      this.isCycleRunning = false; // Reset flag
    }
  }

  async start(testSuite) {
    if (this.isRunning) {
      this.log('Monitor is already running');
      return;
    }

    this.isRunning = true;
    this.log(`🚀 Starting Rocket E2E Monitor for ${testSuite}...`);
    
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
    this.log('Stopping WP Rocket Monitor...');
    this.isRunning = false;
    this.isCycleRunning = false; // Reset cycle flag
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}

// Handle process termination gracefully
const monitor = new WPRocketMonitor();

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