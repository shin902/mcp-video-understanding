import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import { GeminiVideoClient } from "./geminiClient.js";
import {
  ANALYZE_LOCAL_VIDEO_INPUT_SCHEMA,
  ANALYZE_REMOTE_VIDEO_INPUT_SCHEMA,
  ToolName,
  isAnalyzeLocalVideoInput,
  isAnalyzeRemoteVideoInput,
} from "./types.js";

export function createServer(config: AppConfig): Server {
  const client = new GeminiVideoClient(config);

  const server = new Server(
    {
      name: "gemini-video",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "analyzeLocalVideo",
        description:
          "ローカルの動画ファイルを Gemini で要約します。",
        inputSchema: ANALYZE_LOCAL_VIDEO_INPUT_SCHEMA,
      },
      {
        name: "analyzeRemoteVideo",
        description: "YouTube などの公開URLを Gemini で分析します。",
        inputSchema: ANALYZE_REMOTE_VIDEO_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name as ToolName;
    const args = request.params.arguments;

    try {
      switch (toolName) {
        case "analyzeLocalVideo": {
          if (!isAnalyzeLocalVideoInput(args)) {
            throw new Error(
              "Invalid arguments for analyzeLocalVideo. Expecting { filePath: string, prompt?: string, mimeType?: string, model?: string }.",
            );
          }
          const resultText = await client.analyzeLocalVideo(args);
          return toToolResponse(resultText, toolName);
        }
        case "analyzeRemoteVideo": {
          if (!isAnalyzeRemoteVideoInput(args)) {
            throw new Error(
              "Invalid arguments for analyzeRemoteVideo. Expecting { videoUrl: string, prompt?: string, model?: string }.",
            );
          }
          const resultText = await client.analyzeRemoteVideo(args);
          return toToolResponse(resultText, toolName);
        }
        default:
          throw new Error(`Unknown tool requested: ${request.params.name}`);
      }
    } catch (error) {
      const normalized = normalizeError(error);
      logToolError(toolName, args, normalized);
      const friendly = maybeCreateFriendlyErrorResponse(toolName, normalized);
      if (friendly) {
        return friendly;
      }
      throw normalized;
    }
  });

  return server;
}

function toToolResponse(text: string, toolName: ToolName) {
  const safeText =
    text && text.trim().length > 0
      ? text
      : `Gemini returned no textual response for ${toolName}.`;

  return {
    content: [
      {
        type: "text" as const,
        text: safeText,
      },
    ],
  };
}

function logToolError(toolName: ToolName, args: unknown, error: Error): void {
  const serializedArgs = safeSerialize(args);
  console.error(`Tool execution failed (${toolName})`, {
    args: serializedArgs,
    message: error.message,
  });
  if (error.stack) {
    console.error(error.stack);
  }
}

function safeSerialize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserializable arguments]";
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function maybeCreateFriendlyErrorResponse(
  toolName: ToolName,
  error: Error,
): ReturnType<typeof toToolResponse> | null {
  if (toolName !== "analyzeRemoteVideo") {
    return null;
  }
  if (!isPermissionDeniedError(error)) {
    return null;
  }
  const lines = [
    `Gemini API でエラーが発生しました: ${error.message}`,
    "",
    "考えられる原因:",
    "- 限定公開の動画の可能性があります。",
    "- 配信のアーカイブ動画の可能性があります。",
    "",
    "動画を公開設定にして再試行してください。",
    "一般公開されているアーカイブでない動画で試してみてください。",
  ];
  return toToolResponse(lines.join("\n"), toolName);
}

function isPermissionDeniedError(error: Error): boolean {
  const candidate = error as Error & { status?: string; code?: number };
  if (
    typeof candidate.status === "string" &&
    candidate.status.toUpperCase() === "PERMISSION_DENIED"
  ) {
    return true;
  }
  if (typeof candidate.code === "number" && candidate.code === 403) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("does not have permission") ||
    message.includes("403")
  );
}
