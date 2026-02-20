import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateCandidate, ScoutEvaluation } from './ai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const AUTH_FILE = path.join(process.cwd(), 'auth.json');
const BASE_URL = 'https://cr-support.jp';

async function run() {
    console.log('Starting Data Collection...');

    if (!process.env.GAS_WEB_APP_URL) {
        console.error('GAS_WEB_APP_URL not set. Cannot log to Google Sheet.');
        return;
    }

    // Check auth.json
    if (!fs.existsSync(AUTH_FILE)) {
        console.log('No auth.json found. Please run "npm run auth" first.');
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const context: BrowserContext = await browser.newContext({
        storageState: AUTH_FILE,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });

    const page: Page = await context.newPage();

    try {
        // Navigate to Dashboard
        console.log(`Navigating to Dashboard: ${BASE_URL}/mypage/`);
        await page.goto(`${BASE_URL}/mypage/`);
        console.log('Dashboard loaded. Waiting for DOM...');
        await page.waitForLoadState('domcontentloaded');

        // Check if redirected to login (but not group selection)
        if (page.url().includes('/login/') && !page.url().includes('selectGroup')) {
            console.error('CRITICAL: Redirected to Login Page. Session invalid.');
            console.error('Please run "npm run auth" to refresh your session.');
            return;
        }

        // Check for Group Selection Screen
        if (page.url().includes('selectGroup')) {
            console.log('Detected Group Selection Screen.');
            const groupLink = page.locator('.ns-pg-assistant-login-list a').filter({ hasText: 'CEO 伊藤秀嗣' }).first();
            if (await groupLink.isVisible()) {
                console.log('Found "CEO 伊藤秀嗣" group. Clicking...');
                await groupLink.click();
                await page.waitForLoadState('domcontentloaded');
            } else {
                console.log('Could not find specific group "CEO 伊藤秀嗣". Trying partial match "CEO伊藤"...');
                const partialLink = page.locator('a').filter({ hasText: 'CEO伊藤' }).first();
                if (await partialLink.isVisible()) {
                    await partialLink.click();
                    await page.waitForLoadState('domcontentloaded');
                } else {
                    console.error('Failed to select group. Please check the screen.');
                }
            }
            // After selection, it should redirect to dashboard
            await page.waitForTimeout(2000);
        }

        // Wait for Pickup List
        console.log('Waiting for Pickup candidate list (#jsi_resume_block)...');
        try {
            await page.waitForSelector('#jsi_resume_block', { state: 'visible', timeout: 10000 });
        } catch (e) {
            console.log('Timeout waiting for pickup list. Maybe no candidates today or different structure.');
        }

        const candidateRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
        console.log(`Found ${candidateRows.length} Pickup candidates.`);

        if (candidateRows.length === 0) {
            console.log('No pickup candidates found.');
            return;
        }

        // Process all candidates
        for (let i = 0; i < candidateRows.length; i++) {
            const currentRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
            if (i >= currentRows.length) break;

            const row = currentRows[i];
            console.log(`Processing candidate ${i + 1}/${candidateRows.length}...`);

            let candidateUrl = '';
            let classLabel = '';
            let status = '';

            // Open Candidate Detail
            const link = row.locator('a.freescout').first();
            if (await link.isVisible()) {
                await link.click();
                console.log('Clicked candidate link. Waiting for detail view...');

                // Wait for Resume Detail to appear
                try {
                    await page.waitForSelector('#jsi_resume_detail', { state: 'visible', timeout: 10000 });
                } catch (e) {
                    console.error('Timeout waiting for resume detail. skipping...');
                    continue;
                }

                // Extract candidate URL from copy button
                try {
                    const copyUrlButton = page.locator('#jsi_lap_url_copy').first();
                    if (await copyUrlButton.isVisible({ timeout: 3000 })) {
                        const url = await copyUrlButton.getAttribute('data-clipboard-text');
                        if (url) {
                            candidateUrl = url;
                            console.log(`Candidate URL: ${candidateUrl}`);
                        } else {
                            console.log('data-clipboard-text attribute not found');
                            candidateUrl = page.url();
                        }
                    } else {
                        console.log('Copy URL button (#jsi_lap_url_copy) not found');
                        candidateUrl = page.url();
                    }
                } catch (e) {
                    console.error('Failed to get URL from copy button:', e);
                    candidateUrl = page.url();
                }

                // Extract Resume Text
                const resumeContent = await page.locator('#jsi_resume_detail').innerText();
                console.log(`Extracted resume text (${resumeContent.length} chars).`);

                // AI Evaluation
                console.log('Running AI Evaluation...');
                let evaluation: ScoutEvaluation;
                try {
                    evaluation = await evaluateCandidate(resumeContent);
                    console.log(`Evaluation Result: ${evaluation.evaluation} (Level: ${evaluation.level})`);
                    console.log(`Reason: ${evaluation.reason}`);
                } catch (e) {
                    console.error('AI Evaluation failed. Skipping candidate.');
                    const closeBtn = page.locator('#jsi_btnClose');
                    if (await closeBtn.isVisible()) {
                        await closeBtn.click();
                        await page.waitForTimeout(2000);
                    }
                    continue;
                }

                // Map class label
                if (evaluation.level === 'Junior') {
                    classLabel = 'メンバー';
                } else {
                    classLabel = 'ミドル';
                }

                // Determine status
                const decision = ['S', 'A', 'B'].includes(evaluation.evaluation) ? 'SCOUT' : 'SKIP';

                if (decision === 'SCOUT') {
                    // Check if scout button exists
                    const scoutBtn = page.locator('a.freescoutbutton').first();
                    const scoutButtonFound = await scoutBtn.isVisible();

                    if (scoutButtonFound) {
                        status = '送信済';
                        console.log('Scout button found - Status: 送信済');
                    } else {
                        status = '送信済';
                        console.log('Scout button not found (already scouted) - Status: 送信済');
                    }
                } else {
                    status = '対象外';
                    console.log(`Skipping candidate (Rank: ${evaluation.evaluation}) - Status: 対象外`);
                }

                // Log to Google Sheet
                const timestamp = new Date().toISOString();
                const fullReason = `[${evaluation.evaluation}] (Interest:${evaluation.interestLevel}) ${evaluation.reason}`;

                try {
                    console.log(`Sending result to GAS: ${process.env.GAS_WEB_APP_URL}`);
                    await axios.post(process.env.GAS_WEB_APP_URL, {
                        url: candidateUrl,
                        decision: fullReason,
                        class: classLabel,
                        status: status,
                        title: '', // Empty as requested
                        body: '', // Empty as requested
                        timestamp: timestamp,
                        profile: resumeContent,
                        strengths: evaluation.strengths,
                        aspirations: evaluation.aspirations
                    });
                    console.log('Successfully logged to Google Sheet via GAS.');
                } catch (gasError) {
                    console.error('Failed to log to GAS:', gasError);
                }

                // Close candidate detail
                console.log('Closing candidate detail...');
                try {
                    const closeBtn = page.locator('#jsi_btnClose').first();
                    if (await closeBtn.isVisible({ timeout: 2000 })) {
                        await closeBtn.click();
                        await page.waitForTimeout(1000);
                    } else {
                        console.log('Main close button not visible.');
                    }
                } catch (e) {
                    console.log('Error closing detail view:', e);
                }
            }
        }

        console.log('Finished processing all candidates.');

    } catch (error) {
        console.error('Error during data collection:', error);
    } finally {
        await page.waitForTimeout(2000);
        await context.close();
        await browser.close();
    }
}

run().catch(console.error);
