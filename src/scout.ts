import { chromium, BrowserContext, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateCandidate, ScoutEvaluation } from './ai';
import axios from 'axios';
import dotenv from 'dotenv';
import { ElementHandle } from 'playwright-core';

dotenv.config();

const AUTH_FILE = path.join(process.cwd(), 'auth.json');
const BASE_URL = 'https://cr-support.jp';

// BizReach Scout Message Template
const SCOUT_MESSAGE_TEMPLATE = `初めまして。
株式会社オープンロジ代表取締役CEO 伊藤と申します。

{CUSTOM_MESSAGE}

以下をお読みいただき、少しでもご興味をお持ちいただけましたら、
画面下部の「まずは話を聞いてみる」ボタンをタップ・クリックください。

===========
弊社事業
===========
弊社オープンロジは、小売事業者と物流会社に出荷・配送プロダクトを提供しながら、
多くの物流拠点をデジタルで繋ぎ、集約によるスケールメリットと、クラウドような冗長性・可用性のある物流サービスを提供しています。

「社会的インフラ」である物流は、日本の労働力の減少により、数年後には数年後には立ち行かなくなる可能性もあります。TECと多くの物流拠点とのアライアンスを持つ我々だからこそ、この問題を解決することができると信じています。

詳しくはこちらをご覧ください:https://note.openlogi.com/n/n12e1e320e68a\t

================
お声がけのポジション
================
・ポジション:プロダクトマネージャー
・担当プロダクト:
　・【EC事業者向け】SCMプロダクト
　・【倉庫業者向け】フルフィルメントDXプロダクト
のいずれかの領域における既存プロダクト、または新規プロダクト

========
お任せしたい内容
========
ご経験とご志向に基づき、既存プロダクトのグロース(1→10、10→100)または 新規立上プロダクト のいずれかをお任せします。
将来的には、複数プロダクトの総合的な戦略立案、推進を担うリードPdMとしての役割や、チームマネジメント、後進PdMの育成 といった組織構築の面でもご活躍いただくことを期待します。発注調達、輸出入、物流需給の最適化アルゴリズム、生成AI活用など、裁量を持って推進できる領域が多く存在します。

==============
オープンロジで働く魅力
==============
【サプライチェーンの広領域で難易度の高い課題に集中できる環境】
いくつかのプロダクトを横断しながら、サプライチェーンという大きなドメイン領域の中で、難易度の高い課題に裁量を持って取り組むことができます。セールス、マーケ、カスタマーサクセスチームと協力しながら、課題とプロダクトに集中できる環境があります。

=====
PdM関連記事
=====
・"物流"という未開拓領域にあった。レガシーTechにおける、プロダクトマネジメントの難しさと面白さ
#1 https://note.openlogi.com/n/nbfea1196bd71
#2 https://note.openlogi.com/n/nd7bc30406c6a

・登壇記事
事例で学ぶプロダクトマネージャーのお仕事
https://note.openlogi.com/n/n9b255b20e4a2

バーティカル/ホリゾンタルの違いから学ぶプロダクトマネジメントのアプローチ
https://note.openlogi.com/n/n29353a6fa039

ご返信お待ちしております。\t
\t
参考情報\t
■PdM求人:https://note.openlogi.com/n/n12e1e320e68a
■会社説明資料:https://speakerdeck.com/hr01/openlogi-company-profile-for-engineer`;


async function run() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    // Parse mode: --mode=unrated or default to pickup
    const modeArg = args.find(arg => arg.startsWith('--mode='));
    const mode = modeArg ? modeArg.split('=')[1] : 'pickup';

    console.log(`Starting Scout Automation...`);
    console.log(`Mode: ${mode}`);
    console.log(`Dry Run: ${isDryRun}`);

    if (process.env.GAS_WEB_APP_URL) {
        console.log('GAS Integration: Enabled');
    } else {
        console.warn('GAS Integration: Disabled (GAS_WEB_APP_URL not set)');
    }

    if (!fs.existsSync(AUTH_FILE)) {
        console.error(`Auth file not found at ${AUTH_FILE}. Please run 'npm run auth' first.`);
        process.exit(1);
    }

    const isCI = !!process.env.CI;
    const browser = await chromium.launch({ headless: isCI || !isDryRun });
    const context = await browser.newContext({
        storageState: AUTH_FILE,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        if (mode === 'pickup') {
            await runPickupMode(page, isDryRun);
        } else if (mode === 'unrated') {
            await runUnratedMode(page, isDryRun);
        } else if (mode === 'all') {
            console.log('Starting ALL modes (Pickup + Unrated)...');

            console.log('--- Phase 1: Pickup Mode ---');
            try {
                await runPickupMode(page, isDryRun);
                console.log('--- Phase 1: Pickup Mode Finished ---');
            } catch (pickupError) {
                console.error('An error occurred during Pickup Mode:', pickupError);
            }

            console.log('--- Phase 2: Unrated Mode ---');
            await page.waitForTimeout(5000); // 間にしっかり待機を入れる

            // 状態が混ざるのを防ぐため、新しいページを作成して実行
            const unratedPage = await context.newPage();
            try {
                await runUnratedMode(unratedPage, isDryRun);
                console.log('--- Phase 2: Unrated Mode Finished ---');
            } catch (unratedError) {
                console.error('An error occurred during Unrated Mode:', unratedError);
                try {
                    await unratedPage.screenshot({ path: 'unrated_error_screenshot.png' });
                    fs.writeFileSync('unrated_error_dump.html', await unratedPage.content());
                } catch (e) { }
            } finally {
                await unratedPage.close();
            }
        } else {
            console.error(`Unknown mode: ${mode}`);
        }
    } catch (error) {
        console.error('An error occurred during execution:', error);
        try {
            await page.screenshot({ path: 'error_screenshot.png' });
            fs.writeFileSync('error_dump.html', await page.content());
        } catch (e) { }
    } finally {
        await page.waitForTimeout(2000);
        await context.close();
        await browser.close();
    }
}

async function runPickupMode(page: Page, isDryRun: boolean) {
    console.log('--- Executing Pickup Mode ---');
    // 1. Dashboard
    console.log(`Navigating to Dashboard: ${BASE_URL}/mypage/`);
    await page.goto(`${BASE_URL}/mypage/`, { waitUntil: 'networkidle' });
    console.log('Dashboard loaded. Waiting for DOM...');
    await page.waitForLoadState('domcontentloaded');

    await checkLoginRedirect(page);
    await handleGroupSelection(page);

    // 3. Find Pickup List
    console.log('Waiting for Pickup candidate list (#jsi_resume_block)...');
    try {
        await page.waitForSelector('#jsi_resume_block', { state: 'visible', timeout: 10000 });
    } catch (e) {
        console.log('Timeout waiting for pickup list. Maybe no candidates today or different structure.');
        return;
    }

    const candidateRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
    console.log(`Found ${candidateRows.length} Pickup candidates.`);

    if (candidateRows.length === 0) {
        console.log('No pickup candidates found.');
        return;
    }

    const maxCandidates = candidateRows.length;
    for (let i = 0; i < maxCandidates; i++) {
        const currentRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
        if (i >= currentRows.length) break;
        const row = currentRows[i];
        console.log(`Processing Pickup candidate ${i + 1}/${Math.min(maxCandidates, currentRows.length)}...`);

        await processCandidate(page, row, 'pickup', isDryRun);
    }
}

async function runUnratedMode(page: Page, isDryRun: boolean) {
    const UNRATED_URL = 'https://cr-support.jp/scout/highclass/tl/search/unrated?targetJobId=1980129&rlil=5167815&tlMode=true&classRg=&classJr=&classTt=&listType=&searchServiceName=highclass&grdN=true&os=false&ous=true&osc=false&ousc=false&oss=OUS&da=false&dr=false&kw=&kwaf=true&rsc=IVD';

    console.log(`Navigating to Unrated Search: ${UNRATED_URL}`);
    await page.goto(UNRATED_URL, { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    console.log(`Current URL: ${page.url()}`);
    console.log(`Page Title: ${await page.title()}`);
    await page.screenshot({ path: 'unrated_search_start.png' });

    await checkLoginRedirect(page);
    await handleGroupSelection(page);

    // Wait for list
    console.log('Waiting for candidate list (#jsi_resume_block)...');
    try {
        await page.waitForSelector('#jsi_resume_block', { state: 'visible', timeout: 15000 });
    } catch (e) {
        console.warn('Common selector #jsi_resume_block not found in Unrated mode.');
        await page.screenshot({ path: 'debug_unrated_no_list.png' });
        fs.writeFileSync('debug_unrated_list.html', await page.content());
    }

    // Unrated list likely has similar structure but maybe different classes. 
    // We assume 'li' inside the block.
    // If specific class '.md-carditem' is missing, fallback to just 'li' might pick up garbage, but let's try specific first.
    let candidateRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
    if (candidateRows.length === 0) {
        candidateRows = await page.locator('#jsi_resume_block > li').all();
    }
    console.log(`Found ${candidateRows.length} Unrated candidates.`);

    if (candidateRows.length === 0) return;

    const maxCandidates = candidateRows.length;
    for (let i = 0; i < maxCandidates; i++) {
        // Re-fetch to be safe
        let currentRows = await page.locator('#jsi_resume_block > li.md-carditem').all();
        if (currentRows.length === 0) {
            currentRows = await page.locator('#jsi_resume_block > li').all();
        }

        if (i >= currentRows.length) break;
        const row = currentRows[i];

        console.log(`Processing Unrated candidate ${i + 1}/${maxCandidates}...`);
        const result = await processCandidate(page, row, 'unrated', isDryRun);

        // Handle "Rank C" click for Skipped Unrated Candidates
        if (result.decision === 'SKIP' && !result.error) {
            console.log('SKIP action for unrated: Clicking Rank C button...');
            const rankCBtn = row.locator('label').filter({ hasText: 'C評価' }).first();

            if (await rankCBtn.isVisible()) {
                if (!isDryRun) {
                    await rankCBtn.click();
                    console.log('Clicked Rank C button.');
                    await page.waitForTimeout(1000);
                } else {
                    console.log('Dry Run: Skipping Rank C click.');
                }
            } else {
                console.warn('Rank C button not found for this candidate row.');
            }
        }
    }
}

async function checkLoginRedirect(page: Page) {
    if (page.url().includes('/login/') && !page.url().includes('selectGroup')) {
        console.error('CRITICAL: Redirected to Login Page. Session invalid.');
        console.error('Please run "npm run auth" to refresh your session.');
        process.exit(1);
    }
}

async function handleGroupSelection(page: Page) {
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
        await page.waitForTimeout(2000);
    }
}

// Shared Candidate Processing Logic
async function processCandidate(page: Page, row: Locator, mode: 'pickup' | 'unrated', isDryRun: boolean): Promise<{ decision: string, error: boolean }> {
    let evaluation: ScoutEvaluation = {} as ScoutEvaluation;
    let candidateUrl = '';
    let status = '';
    let jobTitle = '';
    let jobBody = '';

    // Click Candidate Link
    let link: Locator;
    if (mode === 'unrated') {
        link = row.locator('.linkPseudo').first();
        if (!(await link.count()) || !(await link.isVisible())) {
            link = row; // Fallback to row click
        }
    } else {
        link = row.locator('a.name, a.freescout, .candidate-name a').first();
    }

    if (!(await link.isVisible())) {
        console.log('Could not find clickable link for candidate. Dumping page.');
        fs.writeFileSync('debug_candidate_error.html', await page.content());
        return { decision: 'ERROR', error: true };
    }

    await link.click();
    console.log('Clicked candidate link. Waiting for detail view...');

    try {
        await page.waitForSelector('#jsi_resume_detail', { state: 'visible', timeout: 10000 });
    } catch (e) {
        console.error('Timeout waiting for resume detail. skipping...');
        // Try close just in case
        return { decision: 'ERROR', error: true };
    }

    // Extract Info
    try {
        const copyUrlButton = page.locator('#jsi_lap_url_copy').first();
        if (await copyUrlButton.isVisible({ timeout: 3000 })) {
            const url = await copyUrlButton.getAttribute('data-clipboard-text');
            candidateUrl = url || page.url();
        } else {
            candidateUrl = page.url();
        }
    } catch (e) {
        candidateUrl = page.url();
    }
    console.log(`Candidate URL: ${candidateUrl}`);

    const resumeContent = await page.locator('#jsi_resume_detail').innerText();
    console.log(`Extracted resume text (${resumeContent.length} chars).`);

    // AI Evaluation
    try {
        evaluation = await evaluateCandidate(resumeContent);
        console.log(`Evaluation Result: ${evaluation.evaluation} (Level: ${evaluation.level})`);
        console.log(`Reason: ${evaluation.reason}`);
    } catch (e) {
        console.error('AI Evaluation failed. Skipping candidate.');
        await closeDetail(page);
        return { decision: 'ERROR', error: true };
    }

    const decision = ['S', 'A', 'B'].includes(evaluation.evaluation) ? 'SCOUT' : 'SKIP';
    console.log(`Decision: ${decision}`);

    // Map class label
    const classLabel = evaluation.level === 'Junior' ? 'PdM（メンバー）' : 'PdM（ミドル）';

    // Generate Message Content (Always, for logging)
    const baseJobTitle = 'サプライチェーンの未来を創るプロダクトマネージャー募集';
    let titleKeyword = evaluation.scoutTitle || '';
    // Ensure 【】 brackets are present
    if (titleKeyword && !titleKeyword.startsWith('【')) {
        titleKeyword = `【${titleKeyword}】`;
    } else if (titleKeyword && !titleKeyword.endsWith('】')) {
        titleKeyword = `${titleKeyword}】`;
    }
    const scoutSubject = `${titleKeyword}${baseJobTitle}`;
    const customMessage = evaluation.scoutMessage || '候補者さまのご経験に興味を持ちました。ぜひ一度、弊社の事業内容や今後の展望についてお話しさせていただけないでしょうか。';
    const calculatedBody = SCOUT_MESSAGE_TEMPLATE.replace('{CUSTOM_MESSAGE}', customMessage);

    console.log(`Generated Scout Title: ${scoutSubject}`);

    // Initialize with calculated values (fallback)
    jobTitle = scoutSubject;
    jobBody = calculatedBody;

    // Scout logic
    if (decision === 'SCOUT') {
        const scoutBtn = page.locator('a.freescoutbutton, a.btnPrimary:has-text("スカウト送信")').first();
        const scoutButtonFound = await scoutBtn.isVisible();

        if (scoutButtonFound) {
            status = isDryRun ? '未送信' : '送信済';
            console.log(`Scout button found - Status: ${status}`);

            // For data collection, we simulate form entry
            try {
                // Force click Scout button
                try {
                    await scoutBtn.click({ force: true });
                } catch (e) {
                    console.log('Standard click failed, trying JS click');
                    await scoutBtn.evaluate((el: HTMLElement) => el.click());
                }
                console.log('Clicked Scout button. Waiting for Message Form...');

                // Wait for Message Form OR Job Selection (depending on mode)
                if (mode === 'pickup') {
                    console.log('Mode is pickup. Waiting for Job Selection Modal and Search Form...');

                    const jobSearchFormSelector = '#jsi_job_search_form';
                    const targetJobTitle = '【事業戦略を牽引】サプライチェーンの未来を創るプロダクトマネージャー募集';

                    try {
                        // Use a more specific selector for the visible modal
                        const jobSelector = '#jsiLightbox.ns-modal-scout-job-selector';
                        await page.waitForSelector(jobSelector, { state: 'visible', timeout: 10000 });

                        // Check if search form is available
                        if (await page.locator(jobSearchFormSelector).isVisible()) {
                            // Input the job title into the search keyword field
                            console.log(`Searching for job: ${targetJobTitle}`);
                            await page.fill(`${jobSearchFormSelector} input[name="kw"]`, targetJobTitle);

                            // Click Search button (class .btnAccept inside .ns-modal-scout-job-selector-searcher-submit)
                            const searchBtn = page.locator('.ns-modal-scout-job-selector-searcher-submit .btnAccept').first();
                            await searchBtn.click();
                            console.log('Clicked Search button. Waiting for results...');

                            // Wait for results table to update
                            await page.waitForTimeout(2000);
                        } else {
                            console.log('Search form not found, trying to find job in current list...');
                        }

                        // Retry loop to find the job row
                        let targetJobRow = null;
                        for (let i = 0; i < 10; i++) {
                            // Try to find the row by text content or data attribute
                            // The row has class 'jsc_job_list' and data-position attribute
                            targetJobRow = page.locator('#jsi_list_table tr.jsc_job_list').filter({ hasText: targetJobTitle }).first();

                            if (await targetJobRow.isVisible()) {
                                console.log('Target job row found by text.');
                                break;
                            }

                            // Fallback to data-position attribute if text fails
                            const specificRow = page.locator(`#jsi_list_table tr[data-position="${targetJobTitle}"]`).first();
                            if (await specificRow.isVisible()) {
                                targetJobRow = specificRow;
                                console.log('Target job row found by data-attribute.');
                                break;
                            }

                            // Fallback to partial text
                            targetJobRow = page.locator('#jsi_list_table tr.jsc_job_list').filter({ hasText: 'サプライチェーンの未来' }).first();
                            if (await targetJobRow.isVisible()) {
                                console.log('Target job row found by partial text.');
                                break;
                            }

                            console.log(`Job row not found yet, retrying... (${i + 1}/10)`);
                            await page.waitForTimeout(1000);
                        }

                        if (!targetJobRow || !(await targetJobRow.isVisible())) {
                            // Log available rows for debugging
                            const rows = await page.locator('#jsi_list_table tr').allInnerTexts();
                            console.log('Available rows text:', rows);
                            throw new Error('Target job row not found after retries.');
                        }

                        console.log('Target job found. Clicking...');
                        await targetJobRow.click();

                    } catch (e) {
                        console.error('Job selection failed:', e);
                        console.log('Dumping job selection modal for debug...');
                        fs.writeFileSync('debug_job_selection.html', await page.content());
                    }
                }

                // Wait for Message Form (Direct access for Unrated, or after job select for Pickup)
                await page.waitForSelector('#jsi_message_subject', { state: 'visible', timeout: 10000 });
                console.log('Message form loaded.');

                // Select Template: 【北島利用】PdM経験者向け (Value: 1225955)
                const templateSelector = '#jsi_message_template_selector';
                if (await page.locator(templateSelector).isVisible()) {
                    console.log('Selecting Template: 【北島利用】PdM経験者向け');
                    await page.selectOption(templateSelector, '1225955');
                    await page.waitForTimeout(1000); // Wait for template to apply
                } else {
                    console.warn('Template selector not found.');
                }

                // Fill Message
                console.log(`Filling Scout Form with Title: ${scoutSubject}`);
                await page.fill('#jsi_message_subject', scoutSubject);
                await page.fill('#jsi_message_body', jobBody);

                // Click "Confirm Content"
                console.log('Clicking Confirm...');
                const confirmBtn = page.locator('input[value="内容を確認"], button:has-text("内容を確認"), a:has-text("内容を確認")').first();
                await confirmBtn.click();

                // Wait for "Send Platinum Scout" button
                console.log('Waiting for Send button...');
                const sendBtnSelector = 'a:has-text("プラチナスカウト送信"), button:has-text("プラチナスカウト送信"), input[value*="送信"]';
                await page.waitForSelector(sendBtnSelector, { state: 'visible', timeout: 10000 });

                const sendBtn = page.locator(sendBtnSelector).first();

                // Send or Dry Run check
                if (!isDryRun) {
                    console.log('Sending Scout...');
                    await sendBtn.click();
                    await page.waitForTimeout(3000); // Wait for submission
                    console.log('Scout Sent Successfully.');
                    status = '送信完了';

                    // 新規追加: 【PdM】スカウト シートへの追加記録
                    await logScoutSent(candidateUrl, classLabel);
                } else {
                    console.log('Dry Run: Skipping actual send click.');
                    status = '下書き(DryRun)';
                }

                // Close candidate detail (handled by finally block or page navigation)

            } catch (e) {
                console.error('Error during scout form flow:', e);
                fs.writeFileSync('debug_scout_form_error.html', await page.content());
                console.log('Saved debug_scout_form_error.html');
                // Try close
                const closeBtn = page.locator('#jsi_btnClose');
                if (await closeBtn.isVisible()) await closeBtn.click();
            }

        } else {
            status = '送信済';
            console.log('Scout button not found (already scouted) - Status: 送信済');
            console.log('Dumping detail page to check why scout button is missing...');
            fs.writeFileSync('debug_missing_scout_button.html', await page.content());

            // Use calculated values for log since we couldn't get from form
            jobTitle = scoutSubject;
            jobBody = calculatedBody;
        }
    } else {
        status = '対象外';
        jobTitle = 'N/A';
        jobBody = '(No message)';
    }

    // Logging
    await logResult(candidateUrl, evaluation, classLabel, status, jobTitle, jobBody, resumeContent);

    // Close Detail
    await closeDetail(page);
    await page.waitForTimeout(1000);

    return { decision, error: false };
}

async function closeDetail(page: Page) {
    console.log('Closing candidate detail...');
    const closeBtn = page.locator('#jsi_btnClose');
    if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(2000);
    }
}

async function logResult(
    url: string,
    evaluation: ScoutEvaluation,
    classLabel: string,
    status: string,
    title: string,
    body: string,
    profile: string
) {
    const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const gasUrl = process.env.GAS_WEB_APP_URL;
    const fullReason = `[${evaluation.evaluation}] (Interest:${evaluation.interestLevel}) ${evaluation.reason}`;

    if (gasUrl) {
        try {
            console.log(`Sending result to GAS: ${gasUrl}`);
            await axios.post(gasUrl, {
                url: url,
                evaluation: evaluation.evaluation,
                decision: fullReason,
                class: classLabel,
                status: status,
                title: title,
                body: body,
                timestamp: timestamp,
                profile: profile,
                strengths: evaluation.strengths,
                aspirations: evaluation.aspirations
            });
        } catch (gasError) {
            console.error('Failed to log to GAS:', gasError);
        }
    }

    const csvLine = `"${url}","${evaluation.evaluation}","${title}","${body.replace(/"/g, '""').replace(/\n/g, '\\n')}","${timestamp}"\n`;
    fs.appendFileSync('scout_results.csv', csvLine);
}

async function logScoutSent(url: string, position: string) {
    const gasUrl = process.env.GAS_WEB_APP_URL;
    if (!gasUrl) return;

    const now = new Date();
    // 日本時間での月と日の取得
    const jstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const month = jstDate.getUTCMonth() + 1;
    const day = jstDate.getUTCDate();
    const weekNum = Math.ceil(day / 7);

    const dateStr = `${jstDate.getUTCFullYear()}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    const weekStr = `${month}月${weekNum}週`;

    try {
        await axios.post(gasUrl, {
            type: 'scout_sent',
            url: url,
            media: 'ビズリーチ',
            position: position,
            sender: 'ゆーや',
            date: dateStr,
            week: weekStr
        });
        console.log(`Logged scout send to 【PdM】スカウト sheet: ${url}`);
    } catch (e) {
        console.error('Failed to log scout send to 【PdM】スカウト sheet:', e);
    }
}

run().catch(console.error);
