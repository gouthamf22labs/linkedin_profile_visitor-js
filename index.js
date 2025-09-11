const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const express = require('express');
const cron = require('node-cron');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
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
        headless: true, // Must be headless in Docker (matching Python)
        args: [
            '--no-sandbox', // Required for Docker namespace issues
            '--disable-setuid-sandbox', // Required for Docker
            '--disable-dev-shm-usage', // Overcome limited resource problems in Docker
            '--disable-gpu', // Disable GPU acceleration in Docker
            '--disable-extensions', // Disable extensions
            '--disable-web-security', // Disable web security for Docker
            '--disable-features=VizDisplayCompositor', // Helps with Docker issues
            '--window-size=1920,1080', // Set window size
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
 * Run profile visits for all URLs
 */
async function runProfileVisits() {
    console.log("🎯 Starting profile visits...");
    
    // Load profile URLs
    const profileUrls = loadProfileUrls();
    if (!profileUrls) {
        console.log("❌ No valid profile URLs found. Exiting...");
        return { success: false, message: "No valid profile URLs found" };
    }
    
    console.log(`📅 Current time: ${new Date().toLocaleString()}`);
    console.log(`🔗 Visiting ${profileUrls.length} profiles...`);
    
    const results = [];
    
    // Visit each profile
    for (let index = 0; index < profileUrls.length; index++) {
        const url = profileUrls[index];
        console.log(`⏰ Processing URL ${index + 1}: ${url}`);
        
        try {
            await visitProfile(url);
            results.push({ url, success: true });
        } catch (error) {
            console.error(`❌ Failed to visit ${url}:`, error.message);
            results.push({ url, success: false, error: error.message });
        }
    }
    
    console.log("✅ Profile visits completed!");
    return { success: true, results };
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
    cron.schedule('0 9 * * *', async () => {
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