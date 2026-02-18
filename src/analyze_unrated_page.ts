import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const AUTH_FILE = path.join(process.cwd(), 'auth.json');
const TARGET_URL = 'https://cr-support.jp/scout/highclass/tl/search/unrated?targetJobId=1980129&rlil=5167815&tlMode=true&classRg=&classJr=&classTt=&listType=&searchServiceName=highclass&grdN=true&os=false&ous=true&osc=false&ousc=false&oss=OUS&da=false&dr=false&kw=&kwaf=true&rsc=IVD';

async function run() {
    if (!fs.existsSync(AUTH_FILE)) {
        console.error(`Auth file not found at ${AUTH_FILE}. Please run 'npm run auth' first.`);
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: false }); // Headed to see what happens
    const context = await browser.newContext({
        storageState: AUTH_FILE,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log(`Navigating to Target URL: ${TARGET_URL}`);
        await page.goto(TARGET_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000); // Wait for dynamic content

        // Check if redirected to login
        if (page.url().includes('/login/')) {
            console.error('Redirected to login. Session expired.');
        } else {
            console.log('Page loaded.');
            fs.writeFileSync('debug_unrated.html', await page.content());
            console.log('Saved debug_unrated.html');

            // Try to find list items
            const items = await page.locator('li.md-carditem').count(); // Guessing same class
            console.log(`Found ${items} items with class .md-carditem (Guess)`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

run();
