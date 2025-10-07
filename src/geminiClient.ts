import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import type { AppConfig } from "./config.js";
import {
  AnalyzeLocalVideoInput,
  AnalyzeRemoteVideoInput,
  resolvePrompt,
} from "./types.js";
import { guessMimeTypeFromPath } from "./utils/file.js";

export class GeminiVideoClient {
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly maxInlineFileBytes: number;

  constructor(config: AppConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.defaultModel = config.model;
    this.maxInlineFileBytes = config.maxInlineFileBytes;
  }


    async analyzeLocalVideo(input: AnalyzeLocalVideoInput): Promise<string>  {
    const prompt = resolvePrompt(input.prompt);
    const model = pickModel(input.model, this.defaultModel);
    const mimeType = input.mimeType ?? guessMimeTypeFromPath(input.filePath) ?? "application/octet-stream";

    // Upload the local file to get a URI, which supports larger files than base64 inline uploads
    const uploaded = await this.ai.files.upload({
      file: input.filePath,
      config: { mimeType },
    });

    // Validate the upload result to ensure we can proceed
    if (uploaded.uri == null || uploaded.mimeType == null) {
      // Attempt to clean up the uploaded file if possible, then throw
      try {
        if (uploaded?.name) {
          await this.ai.files.delete({ name: uploaded.name });
        }
      } catch (error) {
        console.error("Failed to delete uploaded file:", error);
      }
      throw new Error("Upload failed: missing file URI or MIME type");
    }

    try {
      const response = await this.ai.models.generateContent({
        model,
        contents: createUserContent([
          createPartFromUri(uploaded.uri, uploaded.mimeType),
          prompt,
        ]),
      });
      return extractText(response);
    } finally {
      // Ensure the uploaded file is deleted after processing
      try {
        if (uploaded?.name) {
          await this.ai.files.delete({ name: uploaded.name });
        }
      } catch (error) {
        console.error("Failed to delete uploaded file:", error);
      }
    }
  }

  async analyzeRemoteVideo(input: AnalyzeRemoteVideoInput): Promise<string> {
    const prompt = resolvePrompt(input.prompt);
    const model = pickModel(input.model, this.defaultModel);

    const response = await this.ai.models.generateContent({
      model,
      contents: createUserContent([
        createPartFromUri(input.videoUrl, "video/mp4"),
        prompt,
      ]),
    });

    return extractText(response);
  }
}

function pickModel(candidate: string | undefined, fallback: string): string {
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return fallback;
}

type GenerateContentReturn = Awaited<
  ReturnType<GoogleGenAI["models"]["generateContent"]>
>;

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
