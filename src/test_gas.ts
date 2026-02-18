
import axios from 'axios';
import dotenv from 'dotenv';
import * as path from 'path';

// Manual .env loading to ensure it works
dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testGas() {
    const gasUrl = process.env.GAS_WEB_APP_URL;
    if (!gasUrl) {
        console.error('Error: GAS_WEB_APP_URL is not set in .env');
        return;
    }

    console.log(`Testing GAS connectivity to: ${gasUrl}`);

    // Dummy payload simulating a scout result
    const payload = {
        url: 'https://cr-support.jp/resume/window?candidate=TEST_ID',
        decision: 'TEST_DECISION',
        title: 'TEST_JOB_TITLE',
        body: 'This is a test message from the verification script.',
        timestamp: new Date().toISOString()
    };

    try {
        console.log('Sending payload:', payload);
        const response = await axios.post(gasUrl, payload);
        console.log('Response status:', response.status);
        console.log('Response data:', response.data);

        if (response.status === 200 && response.data.status === 'success') {
            console.log('SUCCESS: Data successfully sent to Google Sheet!');
        } else {
            console.log('WARNING: unexpected response format.');
        }

    } catch (error: any) {
        console.error('FAILED: Could not send data to GAS.');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error message:', error.message);
        }
    }
}

testGas();
