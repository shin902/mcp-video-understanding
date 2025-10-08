import { test } from "node:test";
import assert from "node:assert/strict";

import { FileState } from "@google/genai";

import { GeminiVideoClient } from "../../build/geminiClient.js";

function createMockAi({
  states,
  generateResponse = { text: "ok" },
  fileName = "files/mock",
  uploadMimeType = "video/mp4",
  uploadUri = null,
} = {}) {
  const uploadCalls = [];
  const getCalls = [];
  const deleteCalls = [];
  const generateRequests = [];

  let pollIndex = 0;

  const files = {
    upload: async (params) => {
      uploadCalls.push(params);
      return {
        name: fileName,
        mimeType: uploadMimeType,
        uri: uploadUri,
      };
    },
    get: async ({ name }) => {
      getCalls.push(name);
      const stateConfig =
        pollIndex < states.length
          ? states[pollIndex++]
          : states[states.length - 1];

      return {
        name,
        mimeType: stateConfig.mimeType ?? uploadMimeType,
        uri: stateConfig.uri ?? uploadUri,
        state: stateConfig.state,
        error: stateConfig.error,
      };
    },
    delete: async ({ name }) => {
      deleteCalls.push(name);
    },
  };

  const models = {
    generateContent: async (request) => {
      generateRequests.push(request);
      return generateResponse;
    },
  };

  return {
    files,
    models,
    uploadCalls,
    getCalls,
    deleteCalls,
    generateRequests,
  };
}

test("analyzeLocalVideo がファイルの ACTIVE 化を待ってから生成処理を行う", async () => {
  const mockAi = createMockAi({
    states: [
      { state: FileState.PROCESSING },
      { state: FileState.ACTIVE, uri: "https://example.com/file.mp4" },
    ],
    generateResponse: { text: "summarized" },
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-test",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      fileActivationPollIntervalMs: 0,
      fileActivationTimeoutMs: 50,
    },
  );

  const result = await client.analyzeLocalVideo({
    filePath: "video.mp4",
    prompt: "概要をください",
  });

  assert.equal(result, "summarized");
  assert.equal(mockAi.getCalls.length, 2, "ファイル状態取得を2回行う");
  assert.equal(mockAi.generateRequests.length, 1, "generateContentを1回呼び出す");
  assert.deepEqual(mockAi.deleteCalls, ["files/mock"], "完了後にアップロードを削除する");
});

test("analyzeLocalVideo がFAILED stateを検知したらエラーを投げる", async () => {
  const mockAi = createMockAi({
    states: [
      { state: FileState.PROCESSING },
      { state: FileState.FAILED, error: { message: "processing failed" } },
    ],
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-test",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      fileActivationPollIntervalMs: 0,
      fileActivationTimeoutMs: 50,
    },
  );

  await assert.rejects(
    client.analyzeLocalVideo({
      filePath: "video.mp4",
      prompt: "概要をください",
    }),
    /failed to process: processing failed/,
  );

  assert.equal(mockAi.generateRequests.length, 0, "生成APIは呼び出されない");
  assert.deepEqual(mockAi.deleteCalls, ["files/mock"], "失敗時もアップロードを削除する");
});
