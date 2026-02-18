import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const AUTH_FILE = path.join(process.cwd(), 'auth.json');

async function login() {
    console.log('Launching browser for authentication...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await page.goto('https://cr-support.jp/login/');

        const email = process.env.BIZREACH_EMAIL;
        const password = process.env.BIZREACH_PASSWORD;

        if (email && password) {
            console.log('Environment variables found. Attempting automated login...');

            await page.fill('input[name="mailAddress"]', email);
            await page.fill('input[name="password"]', password);

            // Uncheck "Keep me logged in" if needed, or leave as is. 
            // Usually simpler to just click login.

            await page.click('#jsi-login-submit');
            console.log('Clicked login button. Waiting for navigation...');

            try {
                // Wait for navigation to dashboard or group selection
                await page.waitForURL(/.*(mypage|selectGroup).*/, { timeout: 15000 });
                console.log('Navigation successful. Current URL:', page.url());
            } catch (e) {
                console.log('Navigation timeout. We might still be on login page, or it took too long.');
                console.log('Current URL:', page.url());
                // Save debug html to see what happened
                fs.writeFileSync('debug_auth_failure.html', await page.content());
                console.log('Saved debug_auth_failure.html');
            }

        } else {
            console.log('Environment variables BIZREACH_EMAIL or BIZREACH_PASSWORD not set.');
            console.log('Please log in manually.');
            console.log('----------------------------------------------------------------');
            console.log('1. Log in to BizReach in the opened browser.');
            console.log('2. Ensure you are on the dashboard or search page.');
            console.log('3. Come back here and press ENTER to save the session and exit.');
            console.log('----------------------------------------------------------------');

            await new Promise<void>(resolve => {
                process.stdin.once('data', () => resolve());
            });
        }

        await context.storageState({ path: AUTH_FILE });
        console.log(`Session saved to ${AUTH_FILE}`);

    } catch (error) {
        console.error('Login failed:', error);
    } finally {
        await browser.close();
        process.exit(0);
    }
}

login().catch(console.error);
