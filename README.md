# LinkedIn Profile Visitor - Puppeteer Version

This is a Node.js version of the LinkedIn profile visitor bot, converted from Python/Selenium to JavaScript/Puppeteer.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your configuration:
```env
URLS={"urls": ["https://www.linkedin.com/in/profile1", "https://www.linkedin.com/in/profile2"]}
COOKIES_PATH=cookies.json
```

3. Export your LinkedIn cookies to `cookies.json` (same format as the Python version)

## Usage

Run the bot:
```bash
npm start
```

Or for development:
```bash
npm run dev
```

## Key Changes from Python Version

- **Puppeteer instead of Selenium**: More lightweight and faster
- **Async/await**: Modern JavaScript async handling
- **node-schedule**: Equivalent to Python's schedule library
- **Built-in JSON/file handling**: No need for additional libraries like the Python version

## Docker Support

The code automatically detects Docker environment and adjusts Chrome/Chromium paths accordingly, just like the original Python version.

## Scheduling

The code includes three scheduling options (uncomment the one you want):
1. Daily at specific time
2. Every minute (for testing)
3. Run immediately (current default)

## Environment Variables

- `URLS`: JSON string containing LinkedIn profile URLs
- `COOKIES_PATH`: Path to cookies file (optional, defaults based on environment)
