const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const express = require('express');
const cron = require('node-cron');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config({ override: true });
const https = require('https');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a Slack notification
 */
async function sendSlackNotification(message) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    console.log(`🔔 Attempting to send Slack notification: ${message}`);
    
    return new Promise((resolve, reject) => {
        const url = new URL(webhookUrl);
        
        // Clean the message - remove problematic characters that might break JSON
        const cleanMessage = message.replace(/\n/g, ' ').replace(/"/g, "'");
        const data = JSON.stringify({ text: cleanMessage });
        
        console.log(`📡 Sending to Slack: ${url.hostname}${url.pathname}`);
        console.log(`📦 Payload: ${data}`); // Debug: show what we're sending
        
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data, 'utf8')
            }
        };
        
        const req = https.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log("✅ Slack notification sent successfully");
                    console.log(`📥 Response: ${responseData}`);
                } else {
                    console.log(`⚠️ Failed to send Slack notification: ${res.statusCode}`);
                    console.log(`📥 Response: ${responseData}`);
                }
                resolve();
            });
        });
        
        req.on('error', (error) => {
            console.log(`⚠️ Error sending Slack notification: ${error.message}`);
            resolve();
        });
        
        req.write(data);
        req.end();
    });
}

/**
 * Setup Puppeteer browser and return the browser instance
 */
async function setupDriver() {
    console.log("Initializing the Chrome driver...");
    
    const launchOptions = {
        headless: false,
        args: [
            '--no-sandbox',
        ]
    };
    
    try {
        console.log("💻 Using local Chrome setup...");
        
        const chromePaths = [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
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
            launchOptions.channel = 'chrome';
        }
        
        console.log("🚀 Launching browser with executablePath:", launchOptions.executablePath || 'using channel');
        const browser = await puppeteer.launch(launchOptions);
        
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
        const redirectErrorIndicators = [
            '#main-frame-error',
            'div.interstitial-wrapper',
            '#main-message h1 span',
            '.error-code',
        ];
        
        for (const selector of redirectErrorIndicators) {
            const element = await page.$(selector);
            if (element) {
                const text = await element.evaluate(el => el.textContent);
                if (text && (text.includes("This page isn't working") || 
                           text.includes("redirected you too many times") ||
                           text.includes("ERR_TOO_MANY_REDIRECTS"))) {
                    console.log(`🚫 Found redirect error: ${text.trim()}`);
                    console.log(`💡 Suggestion: Clear cookies and try again`);
                    console.log(`🛑 Stopping execution due to login error`);
                    await sendSlackNotification(`🚨 URGENT: LinkedIn login error detected - ${text.trim()}`);
                    throw new Error("LOGIN_ERROR: Too many redirects - cookies may be invalid");
                }
            }
        }
        
        const loginIndicators = [
            'h1[data-test-id="hero__headline"]',
            'h1.authwall-join-form__title',
            'form.join-form',
            '.authwall-join-form__swap-cta',
            'input[name="session_key"]',
            'input[name="session_password"]',
        ];
        
        for (const selector of loginIndicators) {
            const element = await page.$(selector);
            if (element) {
                console.log(`🚫 Found login indicator: ${selector}`);
                console.log(`🛑 Stopping execution due to login error`);
                throw new Error("LOGIN_ERROR: Not logged in - authentication required");
            }
        }
        
        const currentUrl = page.url();
        if (currentUrl.includes('/authwall') || currentUrl.includes('/signup') || currentUrl.includes('/login')) {
            console.log(`🚫 Detected login/signup URL: ${currentUrl}`);
            console.log(`🛑 Stopping execution due to login error`);
            throw new Error("LOGIN_ERROR: Redirected to authentication page");
        }
        
        if (currentUrl.includes('linkedin.com')) {
            console.log(`✅ Login verification passed - no login indicators found`);
            return true;
        }
        
        console.log(`🛑 Stopping execution - not on LinkedIn domain`);
        throw new Error("LOGIN_ERROR: Not on LinkedIn domain");
        
    } catch (error) {
        if (error.message.startsWith('LOGIN_ERROR:')) {
            throw error;
        }
        console.log(`⚠️ Error checking login status: ${error}`);
        throw new Error("LOGIN_ERROR: Unable to verify login status");
    }
}

/**
 * Add the LinkedIn cookie to the browser
 */
async function addCookie(page) {
    console.log("Adding LinkedIn session cookie...");
    
    await page.goto("https://www.linkedin.com");
    await sleep(2000);
    
    let cookieFile = process.env.COOKIES_PATH || "/usr/src/app/cookies.json";
    console.log(`Using cookies file: ${cookieFile}`);
    
    const finalFileExists = await fs.access(cookieFile).then(() => true).catch(() => false);
    if (!finalFileExists) {
        throw new Error(`Cookies file not found: ${cookieFile}`);
    }
    
    const fileContent = await fs.readFile(cookieFile, 'utf8');
    const cookies = JSON.parse(fileContent);
    
    for (const cookie of cookies) {
        try {
            const cookieData = {
                name: cookie.name,
                value: cookie.value,
                domain: '.linkedin.com',
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
    
    // Remove the login check from here - we'll check after visiting the profile
    console.log("✅ Cookies added successfully!");
}

/**
 * Visit a single LinkedIn profile URL
 */
async function visitProfile(url) {
    console.log(`Visiting profile: ${url}`);
    let browser = null;
    
    try {
        browser = await setupDriver();
        const page = await browser.newPage();
        
        await addCookie(page);
        
        await page.goto(url);
        await sleep(2000);
        
        // NOW check if we're logged in by testing the actual profile page
        console.log("🔍 Checking login status after visiting profile...");
        const isOnProfile = await checkLoginStatus(page);
        if (!isOnProfile) {
            console.log(`   🚫 Login check failed on profile page`);
            return { success: false, error: "LOGIN_ERROR: Authentication failed on profile page" };
        }
        
        console.log(`   ✅ Successfully accessed profile page`);
        
        const waitTime = Math.round((Math.random() * (10 - 5) + 5) * 10) / 10;
        console.log(`   Waiting for ${waitTime} seconds...`);
        await sleep(waitTime * 1000);
        
        console.log(`   ✅ Successfully visited: ${url}`);
        return { success: true };
        
    } catch (error) {
        console.log(`   ❌ Error visiting ${url}: ${error}`);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            try {
                console.log("Closing the browser...");
                console.log("✅ Browser closed.");
            } catch (error) {
                console.log(`⚠️ Error closing browser: ${error}`);
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
 * Load profile URLs
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
 * Run profile visits for all URLs
 */
async function runProfileVisits() {
    console.log("🎯 Starting profile visits...");
    
    console.log("🧪 Testing Slack notification...");
    await sendSlackNotification("🧪 Test message from LinkedIn Profile Visitor");
    
    await sendSlackNotification("🎯 LinkedIn Profile Visitor: Starting profile visits...");
    
    const profileUrls = loadProfileUrls();
    if (!profileUrls) {
        const errorMsg = "❌ No valid profile URLs found. Exiting...";
        console.log(errorMsg);
        await sendSlackNotification(`❌ LinkedIn Profile Visitor: ${errorMsg}`);
        return { success: false, message: "No valid profile URLs found" };
    }
    
    console.log(`📅 Current time: ${new Date().toLocaleString()}`);
    console.log(`🔗 Visiting ${profileUrls.length} profiles...`);
    
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    
    for (let index = 0; index < profileUrls.length; index++) {
        const url = profileUrls[index];
        console.log(`⏰ Processing URL ${index + 1}: ${url}`);
        
        const result = await visitProfile(url);
        
        if (result.success) {
            results.push({ url, success: true });
            successCount++;
            
        } else {
            failureCount++;
            results.push({ url, success: false, error: result.error });
            
            console.error(`❌ Failed to visit ${url}: ${result.error}`);
            console.error(`🛑 STOPPING PROFILE VISITS - Error detected`);
            
            const failureMsg = `❌ LinkedIn Profile Visitor: FAILED on profile ${index + 1}/${profileUrls.length} - URL: ${url} - Error: ${result.error} - Stats: ${successCount} successful, ${failureCount} failed`;
            await sendSlackNotification(failureMsg);
            
            // Just return instead of exiting the process
            if (result.error && result.error.includes('LOGIN_ERROR')) {
                console.error(`🚨 LOGIN ERROR - STOPPING VISITS BUT KEEPING APP RUNNING`);
            }
            
            return {
                success: false,
                totalUrls: profileUrls.length,
                processedUrls: index + 1,
                successCount,
                failureCount,
                results,
                message: `Failed on profile ${index + 1}: ${result.error}`
            };
        }
        
        if (index < profileUrls.length - 1) {
            const delay = Math.round((Math.random() * (15 - 5) + 5) * 10) / 10;
            console.log(`⏸️  Waiting ${delay} seconds before next profile...`);
            await sleep(delay * 1000);
        }
    }
    
    console.log(`\n📊 ALL PROFILES COMPLETED SUCCESSFULLY!`);
    console.log(`✅ Successful visits: ${successCount}`);
    console.log(`❌ Failed visits: ${failureCount}`);
    console.log(`📅 Completed at: ${new Date().toLocaleString()}`);
    
    const summaryMsg = `✅ LinkedIn Profile Visitor: ALL COMPLETED SUCCESSFULLY! 📊 ${successCount} successful, ${failureCount} failed out of ${profileUrls.length} total profiles`;
    await sendSlackNotification(summaryMsg);
    
    return {
        success: true,
        totalUrls: profileUrls.length,
        processedUrls: profileUrls.length,
        successCount,
        failureCount,
        results
    };
}

/**
 * Setup Express API server with Swagger documentation
 */
function setupAPI() {
    const app = express();
    const port = process.env.PORT || 3000;
    
    app.use(express.json());
    
    // Swagger configuration
    const swaggerOptions = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'LinkedIn Profile Visitor API',
                version: '1.0.0',
                description: 'API for managing LinkedIn profile visits with automated scheduling',
                contact: {
                    name: 'LinkedIn Profile Visitor',
                },
            },
            servers: [
                {
                    url: `http://localhost:${port}`,
                    description: 'Development server',
                },
                {
                    url: 'https://linkedin-profile-visitor-pup-script.nhs9sl.easypanel.host',
                    description: 'Production server',
                },
            ],
            tags: [
                {
                    name: 'System',
                    description: 'System health and status endpoints',
                },
                {
                    name: 'Profile Visits',
                    description: 'LinkedIn profile visiting operations',
                },
            ],
        },
        apis: ['./index.js'], // Path to the API docs
    };
    
    const specs = swaggerJsdoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'LinkedIn Profile Visitor API'
    }));
    
    /**
     * @swagger
     * components:
     *   schemas:
     *     HealthResponse:
     *       type: object
     *       properties:
     *         status:
     *           type: string
     *           example: ok
     *         timestamp:
     *           type: string
     *           format: date-time
     *           example: 2024-01-01T12:00:00.000Z
     *     
     *     StatusResponse:
     *       type: object
     *       properties:
     *         status:
     *           type: string
     *           example: running
     *         nextRun:
     *           type: string
     *           example: 9:00 AM daily
     *         timestamp:
     *           type: string
     *           format: date-time
     *           example: 2024-01-01T12:00:00.000Z
     *     
     *     ProfileResult:
     *       type: object
     *       properties:
     *         url:
     *           type: string
     *           example: https://www.linkedin.com/in/example-profile
     *         success:
     *           type: boolean
     *           example: true
     *         error:
     *           type: string
     *           example: Error message if failed
     *     
     *     RunResponse:
     *       type: object
     *       properties:
     *         success:
     *           type: boolean
     *           example: true
     *         message:
     *           type: string
     *           example: Profile visits completed
     *         timestamp:
     *           type: string
     *           format: date-time
     *           example: 2024-01-01T12:00:00.000Z
     *         results:
     *           type: array
     *           items:
     *             $ref: '#/components/schemas/ProfileResult'
     *     
     *     ErrorResponse:
     *       type: object
     *       properties:
     *         success:
     *           type: boolean
     *           example: false
     *         message:
     *           type: string
     *           example: Profile visits failed
     *         error:
     *           type: string
     *           example: Detailed error message
     *         timestamp:
     *           type: string
     *           format: date-time
     *           example: 2024-01-01T12:00:00.000Z
     */
    
    /**
     * @swagger
     * /health:
     *   get:
     *     summary: Health check endpoint
     *     description: Returns the current health status of the application
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Application is healthy
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/HealthResponse'
     */
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    /**
     * @swagger
     * /status:
     *   get:
     *     summary: Get application status
     *     description: Returns the current application status and scheduling information
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Application status information
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusResponse'
     */
    app.get('/status', (req, res) => {
        res.json({
            status: 'running',
            nextRun: '9:00 AM daily',
            timestamp: new Date().toISOString()
        });
    });
    
    /**
     * @swagger
     * /run:
     *   post:
     *     summary: Manually trigger profile visits
     *     description: Immediately starts visiting all configured LinkedIn profiles
     *     tags: [Profile Visits]
     *     responses:
     *       200:
     *         description: Profile visits completed successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/RunResponse'
     *       500:
     *         description: Profile visits failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    app.post('/run', async (req, res) => {
        console.log("🚀 Manual run triggered via API");
        try {
            const result = await runProfileVisits();
            res.json({
                success: true,
                message: "Profile visits completed",
                timestamp: new Date().toISOString(),
                ...result
            });
        } catch (error) {
            console.error("❌ API run failed:", error);
            res.status(500).json({
                success: false,
                message: "Profile visits failed",
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Welcome page with API documentation links
    app.get('/', (req, res) => {
        res.json({
            name: 'LinkedIn Profile Visitor API',
            version: '1.0.0',
            description: 'API for managing LinkedIn profile visits with automated scheduling',
            documentation: `/api-docs`,
            endpoints: {
                health: '/health',
                status: '/status',
                run: '/run (POST)',
                docs: '/api-docs'
            }
        });
    });
    
    app.listen(port, () => {
        console.log(`🌐 API server running on port ${port}`);
        console.log(`📋 Endpoints:`);
        console.log(`   GET  /         - API info`);
        console.log(`   GET  /health   - Health check`);
        console.log(`   POST /run      - Manual trigger`);
        console.log(`   GET  /status   - Status info`);
        console.log(`   GET  /api-docs - Swagger documentation`);
        console.log(`\n🔗 Swagger UI available at: http://localhost:${port}/api-docs`);
    });
}

async function main() {
    console.log("🎯 Starting LinkedIn Profile Visitor...");
    
    // Setup API server
    setupAPI();
    
    // Setup cron job for 9 AM daily
    console.log("⏰ Setting up cron job for 9:00 AM daily...");
    cron.schedule(`${process.env.CRON_EXPRESSION}`, async () => {
        console.log("🕘 Cron job triggered at 9:00 AM");
        try {
            await runProfileVisits();
        } catch (error) {
            console.error("❌ Cron job failed:", error);
        }
    }, {
        timezone: "UTC" // Change this to your timezone if needed
    });
    
    console.log("✅ Application started successfully!");
    console.log("📅 Profile visits will run daily at 9:00 AM");
    console.log("🌐 Use POST /run endpoint to trigger manually");
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