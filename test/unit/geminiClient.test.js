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
  onGenerate,
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
      if (onGenerate) {
        return await onGenerate(request, generateRequests.length);
      }
      if (generateResponse instanceof Error) {
        throw generateResponse;
      }
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

test("analyzeRemoteVideo が MIME type を URL から推測して送信する", async () => {
  let capturedRequest;
  const mockAi = createMockAi({
    onGenerate: async (request) => {
      capturedRequest = request;
      return { text: "remote" };
    },
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-2.5-flash",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      sleepFn: async () => {},
    },
  );

  const result = await client.analyzeRemoteVideo({
    videoUrl: "https://example.com/sample.webm",
    prompt: "概要をください",
  });

  assert.equal(result, "remote");
  assert.equal(mockAi.generateRequests.length, 1);

  const content = Array.isArray(capturedRequest.contents)
    ? capturedRequest.contents[0]
    : capturedRequest.contents;
  const filePart = content?.parts?.find((part) => part?.fileData);
  assert.ok(filePart, "fileData part が含まれている");
  assert.equal(filePart.fileData.mimeType, "video/webm");
});

test("analyzeRemoteVideo は内部エラー時にフォールバックモデルを試す", async () => {
  let callCount = 0;
  const mockAi = createMockAi({
    onGenerate: async (request) => {
      callCount += 1;
      if (callCount === 1) {
        const error = new Error("internal");
        error.status = "INTERNAL";
        throw error;
      }
      return { text: "fallback ok" };
    },
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-2.5-flash",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      sleepFn: async () => {},
      remoteRetry: {
        maxAttempts: 1,
        fallbackModels: ["gemini-2.0-flash-exp"],
      },
    },
  );

  const result = await client.analyzeRemoteVideo({
    videoUrl: "https://example.com/movie.mp4",
    prompt: "概要をください",
  });

  assert.equal(result, "fallback ok");
  assert.equal(mockAi.generateRequests.length, 2);
  assert.equal(mockAi.generateRequests[0].model, "gemini-2.5-flash");
  assert.equal(mockAi.generateRequests[1].model, "gemini-2.0-flash-exp");
});

test("analyzeRemoteVideo は status が '500' の文字列でも再試行する", async () => {
  let callCount = 0;
  const mockAi = createMockAi({
    onGenerate: async () => {
      callCount += 1;
      if (callCount === 1) {
        const error = new Error("internal 500");
        error.status = "500";
        throw error;
      }
      return { text: "string code ok" };
    },
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-2.5-flash",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      sleepFn: async () => {},
      remoteRetry: {
        maxAttempts: 2,
        initialDelayMs: 0,
      },
    },
  );

  const result = await client.analyzeRemoteVideo({
    videoUrl: "https://example.com/movie.mp4",
    prompt: "概要をください",
  });

  assert.equal(result, "string code ok");
  assert.equal(callCount, 2);
});

test("analyzeRemoteVideo が YouTube URL の500エラーで Vertex 利用を促す", async () => {
  const mockAi = createMockAi({
    onGenerate: async () => {
      const error = new Error("internal");
      error.status = "INTERNAL";
      throw error;
    },
  });

  const client = new GeminiVideoClient(
    {
      apiKey: "dummy",
      model: "gemini-2.5-flash",
      maxInlineFileBytes: 10,
    },
    {
      aiClient: mockAi,
      sleepFn: async () => {},
      remoteRetry: {
        maxAttempts: 1,
      },
    },
  );

  await assert.rejects(
    client.analyzeRemoteVideo({
      videoUrl: "https://www.youtube.com/watch?v=abcd",
      prompt: "概要をください",
    }),
    /Vertex AI を利用するか/,
  );
});
