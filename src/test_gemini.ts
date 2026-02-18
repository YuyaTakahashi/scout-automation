
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not found in .env');
        return;
    }

    console.log('Testing Gemini API with key:', apiKey.substring(0, 10) + '...');
    const genAI = new GoogleGenerativeAI(apiKey);

    const models = ['gemini-2.0-flash-001', 'gemini-2.0-flash-lite', 'gemini-pro-latest'];

    for (const modelName of models) {
        try {
            console.log(`\n--- Testing Model: ${modelName} ---`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Say "Hello World"');
            const response = await result.response;
            console.log(`Success! Response: ${response.text()}`);
        } catch (error: any) {
            console.error(`Failed with model ${modelName}:`);
            console.error(`Status: ${error.status}`);
            console.error(`Message: ${error.message}`);
        }
    }
}

testGemini();
