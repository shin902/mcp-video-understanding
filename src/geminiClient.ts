import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  FileState,
} from "@google/genai";
import type { AppConfig } from "./config.js";
import {
  AnalyzeLocalVideoInput,
  AnalyzeRemoteVideoInput,
  resolvePrompt,
} from "./types.js";
import { guessMimeTypeFromPath } from "./utils/file.js";

export interface GeminiVideoClientOptions {
  aiClient?: GoogleGenAI;
  fileActivationTimeoutMs?: number;
  fileActivationPollIntervalMs?: number;
  remoteRetry?: Partial<RemoteVideoRetryOptions>;
  sleepFn?: (ms: number) => Promise<void>;
}

export class GeminiVideoClient {
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly maxInlineFileBytes: number;
  private readonly fileActivationTimeoutMs: number;
  private readonly fileActivationPollIntervalMs: number;
  private readonly remoteRetry: RemoteVideoRetryOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: AppConfig, options: GeminiVideoClientOptions = {}) {
    this.ai = options.aiClient ?? new GoogleGenAI({ apiKey: config.apiKey });
    this.defaultModel = config.model;
    this.maxInlineFileBytes = config.maxInlineFileBytes;
    this.fileActivationTimeoutMs =
      options.fileActivationTimeoutMs ?? 60_000;
    this.fileActivationPollIntervalMs =
      options.fileActivationPollIntervalMs ?? 1_000;
    this.remoteRetry = {
      maxAttempts: options.remoteRetry?.maxAttempts ?? 2,
      initialDelayMs: options.remoteRetry?.initialDelayMs ?? 1_500,
      backoffMultiplier: options.remoteRetry?.backoffMultiplier ?? 2,
      fallbackModels: options.remoteRetry?.fallbackModels ?? [
        "gemini-2.0-flash-exp",
      ],
    };
    this.sleep = options.sleepFn ?? delay;
  }

  async analyzeLocalVideo(input: AnalyzeLocalVideoInput): Promise<string> {
    const prompt = resolvePrompt(input.prompt);
    const model = pickModel(input.model, this.defaultModel);
    const mimeType = input.mimeType ?? guessMimeTypeFromPath(input.filePath) ?? "application/octet-stream";

    // Upload the local file to get a URI, which supports larger files than base64 inline uploads
    const uploaded = await this.ai.files.upload({
      file: input.filePath,
      config: { mimeType },
    });

    if (!uploaded?.name) {
      throw new Error("Upload failed: missing file name to poll status");
    }

    let activeFile: GeminiFile | null = null;
    try {
      activeFile = await this.waitForFileActivation(uploaded.name);

      if (activeFile.uri == null || activeFile.mimeType == null) {
        throw new Error("Upload failed: missing file URI or MIME type after activation");
      }

      const response = await this.ai.models.generateContent({
        model,
        contents: createUserContent([
          createPartFromUri(activeFile.uri, activeFile.mimeType),
          prompt,
        ]),
      });
      return extractText(response);
    } finally {
      // Ensure the uploaded file is deleted after processing
      try {
        const nameToDelete = activeFile?.name ?? uploaded.name;
        if (nameToDelete) {
          await this.ai.files.delete({ name: nameToDelete });
        }
      } catch (error) {
        console.error("Failed to delete uploaded file:", error);
      }
    }
  }

  async analyzeRemoteVideo(input: AnalyzeRemoteVideoInput): Promise<string> {
    const prompt = resolvePrompt(input.prompt);
    const model = pickModel(input.model, this.defaultModel);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.videoUrl);
    } catch (error) {
      throw new Error(
        `Invalid videoUrl provided to analyzeRemoteVideo: ${input.videoUrl}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    const mimeTypeFromUrl = guessMimeTypeFromPath(parsedUrl.pathname);
    const mimeType = mimeTypeFromUrl ?? "application/octet-stream";
    const requestPart = createPartFromUri(parsedUrl.toString(), mimeType);
    const hostsRequiringVertex = new Set([
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ]);
    const isYoutubeUrl = hostsRequiringVertex.has(parsedUrl.hostname);

    const modelsToTry = dedupeModels([
      model,
      ...this.remoteRetry.fallbackModels,
    ]);

    let lastError: unknown = null;

    for (const modelCandidate of modelsToTry) {
      let delayMs = this.remoteRetry.initialDelayMs;

      for (let attempt = 1; attempt <= this.remoteRetry.maxAttempts; attempt++) {
        try {
          const response = await this.ai.models.generateContent({
            model: modelCandidate,
            contents: createUserContent([requestPart, prompt]),
          });
          return extractText(response);
        } catch (error) {
          lastError = error;

          if (isYoutubeUrl && isInternalError(error)) {
            throw new Error(
              "Gemini Developer API は YouTube のリモート動画解析を安定して扱えません。Vertex AI を利用するか、動画をダウンロードしてから analyzeLocalVideo を使ってください。",
              { cause: error instanceof Error ? error : undefined },
            );
          }

          const shouldRetry =
            attempt < this.remoteRetry.maxAttempts && isInternalError(error);
          if (!shouldRetry) {
            break;
          }

          await this.sleep(Math.max(delayMs, 0));
          delayMs *= this.remoteRetry.backoffMultiplier;
        }
      }
    }

    throw new Error(
      "Gemini remote video analysis failed after retrying different models. 最新の回避策については https://ai.google.dev/gemini-api/docs/troubleshooting を確認してください。",
      { cause: lastError instanceof Error ? lastError : undefined },
    );
  }

  private async waitForFileActivation(fileName: string): Promise<GeminiFile> {
    const deadline = Date.now() + this.fileActivationTimeoutMs;

    while (Date.now() <= deadline) {
      const file = await this.ai.files.get({ name: fileName });

      if (file.state === FileState.ACTIVE) {
        return file;
      }

      if (file.state === FileState.FAILED) {
        const reason = file.error?.message ?? "unknown error";
        throw new Error(
          `Uploaded file ${fileName} failed to process: ${reason}`,
        );
      }

      await delay(this.fileActivationPollIntervalMs);
    }

    throw new Error(
      `Timed out waiting for uploaded file ${fileName} to become ACTIVE`,
    );
  }
}

function pickModel(candidate: string | undefined, fallback: string): string {
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return fallback;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type GeminiFile = Awaited<ReturnType<GoogleGenAI["files"]["get"]>>;

type GenerateContentReturn = Awaited<
  ReturnType<GoogleGenAI["models"]["generateContent"]>
>;

interface RemoteVideoRetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  fallbackModels: string[];
}

function extractText(result: GenerateContentReturn): string {
  if (!result) {
    return "";
  }

  const directText = (result as { text?: unknown }).text;
  if (typeof directText === "string" && directText.length > 0) {
    return directText;
  }
  if (typeof directText === "function") {
    const maybeText = (directText as () => string)();
    if (maybeText && maybeText.length > 0) {
      return maybeText;
    }
  }

  const nested = (
    result as { response?: { text?: unknown; candidates?: unknown } }
  ).response;
  if (nested) {
    if (typeof nested.text === "string" && nested.text.length > 0) {
      return nested.text;
    }
    if (typeof nested.text === "function") {
      const maybeText = (nested.text as () => string)();
      if (maybeText && maybeText.length > 0) {
        return maybeText;
      }
    }

    const candidates = (
      nested as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      }
    ).candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const parts = candidates[0]?.content?.parts;
      if (Array.isArray(parts) && parts.length > 0) {
        const textParts = parts
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter((part) => part.length > 0);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
    }
  }

  return "";
}

function isInternalError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { status?: unknown; code?: unknown };
  const status = candidate.status;
  if (typeof status === "number") {
    if (status === 500) {
      return true;
    }
  } else if (typeof status === "string") {
    const normalized = status.trim().toUpperCase();
    if (normalized === "500") {
      return true;
    }
    if (normalized === "INTERNAL" || normalized === "INTERNAL_ERROR") {
      return true;
    }
  }
  const code = candidate.code;
  if (typeof code === "number") {
    if (code === 500 || code === 13) {
      return true;
    }
  }
  return false;
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
