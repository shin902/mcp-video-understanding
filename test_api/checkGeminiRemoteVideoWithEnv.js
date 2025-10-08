// ESM script to check sending a remote YouTube video to Gemini using .env
// Usage: npm test (after this repo's build), or: node test_api/checkGeminiRemoteVideoWithEnv.js

import { config as loadEnv } from "dotenv";
loadEnv();

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GeminiVideoClient } from "../build/geminiClient.js";

const apiKey =
  process.env.GOOGLE_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_API ||
  "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIDEO_URL_FILE = path.join(__dirname, "gemini_remote_video_url.txt");

const prompt =
  "この動画の内容を日本語で簡潔に要約してください。重要なポイントを箇条書きで教えてください。";

async function main() {
  if (!apiKey) {
    console.error(
      "GEMINI_API (or GEMINI_API_KEY/GOOGLE_API_KEY) is not set in environment/.env",
    );
    process.exitCode = 1;
    return;
  }

  let url = "";
  try {
    url = (await readFile(VIDEO_URL_FILE, "utf8")).trim();
  } catch (err) {
    console.error(
      `動画URLファイル(${VIDEO_URL_FILE})の読み込みに失敗しました: ${err.message}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!url) {
    console.error(
      `動画URLファイル(${VIDEO_URL_FILE})に有効なURLが含まれていません。`,
    );
    process.exitCode = 1;
    return;
  }

  const client = new GeminiVideoClient({
    apiKey,
    model: "gemini-2.5-flash-lite",
    maxInlineFileBytes: 10 * 1024 * 1024,
  });

  try {
    const result = await client.analyzeRemoteVideo({
      videoUrl: url,
      prompt,
    });
    console.log(result);
  } catch (err) {
    console.error("Gemini remote video check failed:", err);
    process.exitCode = 1;
  }
}

await main();
