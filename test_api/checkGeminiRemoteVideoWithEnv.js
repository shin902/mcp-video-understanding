// ESM script to check sending a remote YouTube video to Gemini using .env
// Usage: npm test (after this repo's build), or: node test_api/checkGeminiRemoteVideoWithEnv.js

import { config as loadEnv } from 'dotenv';
loadEnv();

import { GeminiVideoClient } from '../build/geminiClient.js';

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_API || "";

if (!apiKey) {
  console.error('GEMINI_API (or GEMINI_API_KEY/GOOGLE_API_KEY) is not set in environment/.env');
  process.exitCode = 1;
} else {
  const client = new GeminiVideoClient({
    apiKey,
    model: 'gemini-2.5-flash',
    maxInlineFileBytes: 10 * 1024 * 1024,
  });

  const url = 'https://www.youtube.com/watch?v=AW8GCHzuZmU&t=1s';
  const prompt = 'この動画の内容を日本語で簡潔に要約してください。重要なポイントを箇条書きで教えてください。';

  try {
    const result = await client.analyzeRemoteVideo({
      videoUrl: url,
      prompt,
    });
    console.log(result);
  } catch (err) {
    console.error('Gemini remote video check failed:', err);
    process.exitCode = 1;
  }
}
