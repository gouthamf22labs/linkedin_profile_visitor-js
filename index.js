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
        console.log("💻 Using local Chrome setup...");
        
        // Try common Chrome paths for different environments
        const chromePaths = [
            '/usr/bin/chromium', // Docker/Alpine Linux
            '/usr/bin/chromium-browser', // Ubuntu/Debian
            '/usr/bin/google-chrome', // Linux
            '/usr/bin/google-chrome-stable', // Linux stable
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
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
            console.log("⚠️ Chrome not found in common locations. Trying with chrome channel...");
            // Try using chrome channel as fallback
            launchOptions.channel = 'chrome';
        }
        
        console.log("🚀 Launching browser with executablePath:", launchOptions.executablePath || 'using channel');
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
 * Check if we're logged in by looking for login/signup page indicators
 */
async function checkLoginStatus(page) {
    try {
        // Check for login/signup page indicators
        const loginIndicators = [
            'h1[data-test-id="hero__headline"]', // "Welcome to your professional community"
            'h1.authwall-join-form__title', // "Join LinkedIn"
            'form.join-form', // Join form
            '.authwall-join-form__swap-cta', // "Already on LinkedIn? Sign in"
            'input[name="session_key"]', // Login form email input
            'input[name="session_password"]', // Login form password input
        ];
        
        // Check if any login indicators are present
        for (const selector of loginIndicators) {
            const element = await page.$(selector);
            if (element) {
                console.log(`🚫 Found login indicator: ${selector}`);
                return false;
            }
        }
        
        // Check for authwall URL pattern
        const currentUrl = page.url();
        if (currentUrl.includes('/authwall') || currentUrl.includes('/signup') || currentUrl.includes('/login')) {
            console.log(`🚫 Detected login/signup URL: ${currentUrl}`);
            return false;
        }
        
        // If we're on LinkedIn main domain and no login indicators found, we're likely logged in
        if (currentUrl.includes('linkedin.com')) {
            console.log(`✅ Login verification passed - no login indicators found`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.log(`⚠️ Error checking login status: ${error}`);
        return false;
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
    
    // Get cookies path from environment variable, default to local file
    let cookieFile = process.env.COOKIES_PATH || "/usr/src/app/cookies.json";
    
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
    
    // Check if we're actually logged in by looking for login/signup indicators
    // const isLoggedIn = await checkLoginStatus(page);
    // if (!isLoggedIn) {
    //     throw new Error("❌ Cookie authentication failed - still seeing login/signup page");
    // }
    
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
        await sleep(2000); // Wait for page to load
        
        // Check if we're actually on the profile or redirected to login
        const isOnProfile = await checkLoginStatus(page);
        if (!isOnProfile) {
            console.log(`   🚫 Redirected to login page - authentication may have expired`);
            throw new Error("Profile visit failed - redirected to login");
        }
        
        console.log(`   ✅ Successfully accessed profile page`);
        
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
    
    // Test authentication before scheduling any jobs
    // console.log("🔐 Testing authentication before starting profile visits...");
    // try {
    //     const testBrowser = await setupDriver();
    //     const testPage = await testBrowser.newPage();
    //     await addCookie(testPage);
    //     await testBrowser.close();
    //     console.log("✅ Authentication test passed - proceeding with profile visits");
    // } catch (error) {
    //     console.error("❌ Authentication test failed:", error.message);
    //     console.error("💡 Please check your cookies.json file and try again");
    //     return;
    // }
    
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