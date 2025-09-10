const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');
const schedule = require('node-schedule');
require('dotenv').config({ override: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Setup Puppeteer browser and return the browser instance
 */
async function setupDriver() {
    console.log("Initializing the Chrome driver...");
    
    // Setup Chrome options for Docker environment
    const launchOptions = {
        headless: false, // Must be headless in Docker (matching Python)
        args: [
            // Only essential arguments, most are commented out like in Python
            // '--no-sandbox', // Required for Docker (commented out like Python)
            // '--disable-dev-shm-usage', // Overcome limited resource problems (commented out like Python)
            // '--disable-gpu', // Disable GPU acceleration (commented out like Python)
            // '--disable-extensions', // Disable extensions (commented out like Python)
            // '--window-size=1920,1080', // Set window size (commented out like Python)
            // '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    };
    
    // Additional options to avoid detection (commented out like Python)
    // launchOptions.args.push('--disable-blink-features=AutomationControlled');
    
    try {
        // Detect if we're running in Docker by checking for the Docker-specific paths
        const dockerChromiumExists = await fs.access('/usr/bin/chromium').then(() => true).catch(() => false);
        const dockerDriverExists = await fs.access('/usr/local/bin/chromedriver').then(() => true).catch(() => false);
        
        if (dockerChromiumExists && dockerDriverExists) {
            console.log("🐳 Detected Docker environment, using Docker Chrome setup...");
            launchOptions.executablePath = '/usr/bin/chromium';
        } else {
            console.log("💻 Using local Chrome setup...");
            // For local development with puppeteer-core, try common Chrome paths
            const chromePaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
                '/usr/bin/google-chrome', // Linux
                '/usr/bin/chromium-browser', // Linux alternative
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' // Windows 32-bit
            ];
            
            for (const chromePath of chromePaths) {
                const exists = await fs.access(chromePath).then(() => true).catch(() => false);
                if (exists) {
                    launchOptions.executablePath = chromePath;
                    console.log(`Found Chrome at: ${chromePath}`);
                    break;
                }
            }
            
            if (!launchOptions.executablePath) {
                console.log("⚠️ Chrome not found in common locations. Puppeteer-core will try default system Chrome.");
            }
        }
        
        const browser = await puppeteer.launch(launchOptions);
        
        // Execute script to remove automation detection (matching Python)
        const pages = await browser.pages();
        const page = pages[0];
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        });
        
        console.log("✅ Chrome driver initialized successfully!");
        return browser;
        
    } catch (error) {
        console.error(`❌ Failed to initialize Chrome driver: ${error}`);
        console.log("💡 Make sure Chrome/Chromium is installed and accessible");
        throw error;
    }
}

/**
 * Add the LinkedIn cookie to the browser (simplified version)
 */
async function addCookie(page) {
    console.log("Adding LinkedIn session cookie...");
    
    // Ensure we're on LinkedIn
    await page.goto("https://www.linkedin.com");
    await sleep(2000);
    
    // Get cookies path from environment variable, with Docker-friendly default
    let cookieFile = process.env.COOKIES_PATH || "/app/cookies.json";
    
    // If running locally (not in Docker), fall back to local path
    const fileExists = await fs.access(cookieFile).then(() => true).catch(() => false);
    if (!fileExists && cookieFile === "/app/cookies.json") {
        cookieFile = "cookies.json";
    }
    
    console.log(`Using cookies file: ${cookieFile}`);
    
    // Verify the file exists
    const finalFileExists = await fs.access(cookieFile).then(() => true).catch(() => false);
    if (!finalFileExists) {
        throw new Error(`Cookies file not found: ${cookieFile}`);
    }
    
    const fileContent = await fs.readFile(cookieFile, 'utf8');
    const cookies = JSON.parse(fileContent);
    
    for (const cookie of cookies) {
        try {
            // Only add essential cookie data (matching Python exactly)
            const cookieData = {
                name: cookie.name,
                value: cookie.value,
                domain: '.linkedin.com', // Force LinkedIn domain
                path: '/'
            };
            
            await page.setCookie(cookieData);
            console.log(`✅ Added cookie: ${cookie.name}`);
            
        } catch (error) {
            console.log(`⚠️ Failed to add cookie ${cookie.name || 'unknown'}: ${error}`);
            continue;
        }
    }
    
    await page.reload();
    await sleep(2000);
    console.log("✅ Logged in using cookies!");
}

/**
 * Visit a single LinkedIn profile URL
 */
async function visitProfile(url) {
    console.log(`Visiting profile: ${url}`);
    let browser = null;
    
    try {
        browser = await setupDriver(); // Initialize the driver for each job
        const page = await browser.newPage();
        
        // Add the LinkedIn cookie
        await addCookie(page);
        
        // Visit the profile
        await page.goto(url);
        
        // Random wait time between 5-10 seconds with 1 decimal place (matching Python exactly)
        const waitTime = Math.round((Math.random() * (10 - 5) + 5) * 10) / 10;
        console.log(`   Waiting for ${waitTime} seconds...`);
        await sleep(waitTime * 1000);
        
        console.log(`   ✅ Successfully visited: ${url}`);
        
    } catch (error) {
        console.log(`   ❌ Error visiting ${url}: ${error}`);
    } finally {
        // Close the browser and cleanup
        if (browser) {
            try {
                console.log("Closing the browser...");
                await browser.close();
                console.log("✅ Browser closed.");
            } catch (error) {
                console.log(`⚠️ Error closing browser: ${error}`);
                // Force kill Chrome processes if close fails
                try {
                    const { exec } = require('child_process');
                    exec('pkill -f chromium', () => {});
                } catch {
                    // Ignore errors
                }
            }
        }
    }
}

/**
 * Load LinkedIn profile URLs from environment variable
 */
function loadProfileUrls() {
    try {
        const urls = process.env.URLS;
        const urlsJson = JSON.parse(urls);
        console.log(`✅ Loaded ${urlsJson.urls.length} profile URLs.`);
        return urlsJson.urls;
    } catch (error) {
        console.log(`❌ Error loading URLs: ${error}`);
        return [];
    }
}

/**
 * Main function
 */
async function main() {
    console.log("🎯 Starting main function...");
    
    // Load profile URLs
    const profileUrls = loadProfileUrls();
    if (!profileUrls) {
        console.log("❌ No valid profile URLs found. Exiting...");
        return;
    }
    
    console.log(`📅 Current time: ${new Date().toLocaleString()}`);
    
    // Schedule a job for each URL
    for (let index = 0; index < profileUrls.length; index++) {
        const url = profileUrls[index];
        
        // Schedule each job at a specific time
        const scheduleTime = "13:39"; // Change this to your desired time
        console.log(`⏰ Scheduling job for URL ${index + 1} at ${scheduleTime}: ${url}`);
        
        // Uncomment one of these scheduling options:
        // schedule.scheduleJob('39 13 * * *', () => visitProfile(url)); // Schedule for specific time daily
        // schedule.scheduleJob('* * * * *', () => visitProfile(url)); // Schedule every minute
        
        // Run immediately (current behavior, matching Python)
        await visitProfile(url);
    }
    
    console.log("✅ Scheduler is running. Jobs are scheduled for each URL.");
    console.log("⏳ Waiting for scheduled time...");
    
    // Keep the script running to allow the scheduler to execute the jobs
    while (true) {
        const currentTime = new Date().toLocaleString();
        console.log(`🕐 Current time: ${currentTime}`);
        
        // Check for pending scheduled jobs
        // Note: In the Python version this runs schedule.run_pending()
        // Here we're just keeping the process alive since we're running immediately
        
        await sleep(1000); // Sleep 1 second like Python
    }
}

// Run the main function if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    setupDriver,
    addCookie,
    visitProfile,
    loadProfileUrls,
    main
};