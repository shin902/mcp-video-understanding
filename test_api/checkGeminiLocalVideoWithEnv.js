// ESM script to check sending a local MP4 file to Gemini using .env
// Usage: npm test (after this repo's build), or: node test_api/checkGeminiLocalVideoWithEnv.js

import { config as loadEnv } from 'dotenv';
loadEnv();

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { GeminiVideoClient } from '../build/geminiClient.js';

// Prefer environment variables
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_API || "";

if (!apiKey) {
  console.error('GOOGLE_API_KEY (or GEMINI_API_KEY/GEMINI_API) is not set in environment/.env');
  process.exitCode = 1;
} else {
  const client = new GeminiVideoClient({
    apiKey,
    model: 'gemini-2.5-flash',
    maxInlineFileBytes: 10 * 1024 * 1024,
  });

  // Resolve the test file path relative to this script location to avoid CWD issues
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const filePath = path.resolve(__dirname, 'test.mp4');

  if (!existsSync(filePath)) {
    console.error(`Local test video not found at: ${filePath}`);
    process.exitCode = 1;
  } else {
    const prompt = 'このローカル動画の内容を日本語で簡潔に要約してください。重要なポイントを箇条書きで教えてください。';

    try {
      // Intentionally omit mimeType to verify automatic file type detection from extension
      const result = await client.analyzeLocalVideo({
        filePath,
        prompt,
      });
      console.log(result);
    } catch (err) {
      console.error('Gemini local video check failed:', err);
      process.exitCode = 1;
    }
  }
}
