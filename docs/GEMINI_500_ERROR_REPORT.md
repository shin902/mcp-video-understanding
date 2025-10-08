# Gemini API 500エラー調査レポート

## 1. エラー概要

### 発生したエラー
```
ApiError: {"error":{"code":500,"message":"An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting","status":"INTERNAL"}}
```

### 発生状況
- **テストコード**: `test_api/checkGeminiRemoteVideoWithEnv.js`
- **機能**: リモート動画（YouTube URL）の解析
- **使用モデル**: `gemini-2.5-flash`
- **対象URL**: `https://www.youtube.com/watch?v=AW8GCHzuZmU&t=1s`

## 2. エラーの原因分析

### 2.1 Gemini API側のサーバーエラー
このエラーはGoogle側のサーバー問題であり、クライアント側のコードに問題がある可能性は低いです。

### 2.2 既知の問題パターン

#### パターン1: YouTube URL処理の制限
- **状況**: YouTube URLを直接Gemini APIに送信すると500エラーが発生
- **影響範囲**: 標準のGemini API（Developer API）使用時
- **フォーラム報告**: https://discuss.ai.google.dev/t/500-error-when-trying-send-video-from-youtube-url/60478

#### パターン2: gemini-2.5-proモデルのビジョン処理の不安定性
- **状況**: `gemini-2.5-pro`でのビジョン/動画処理時に500エラーが頻発
- **特徴**: テキストのみのリクエストは正常に動作
- **GitHub Issue**: https://github.com/googleapis/python-genai/issues/1304
- **報告**: gemini-2.5-proの25%のリクエストで500エラーが発生するケースも

#### パターン3: Gemini 2.5シリーズ全体の一時的な不安定性
- **時期**: 2025年前半（現在進行中）
- **影響**: gemini-2.5-flash、gemini-2.5-proでの動画/画像処理
- **対照**: gemini-2.0-flash-expは同じコードで正常に動作

## 3. 現在のコード実装の問題点

### `src/geminiClient.ts:analyzeRemoteVideo()`
```typescript
async analyzeRemoteVideo(input: AnalyzeRemoteVideoInput): Promise<string> {
  const prompt = resolvePrompt(input.prompt);
  const model = pickModel(input.model, this.defaultModel);

  const response = await this.ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(input.videoUrl, "video/mp4"),  // ← ここが問題
      prompt,
    ]),
  });

  return extractText(response);
}
```

**問題点**:
1. YouTube URLを`video/mp4`として直接送信している
2. Vertex AIを使用していない（標準のGemini APIでは動作しない可能性が高い）
3. エラーハンドリングやリトライロジックがない

## 4. 回避策と解決方法

### 4.1 推奨: Vertex AI経由での処理
フォーラムの報告によると、YouTube URL処理にはVertex AIの使用が必須です。

```javascript
// 標準APIではなくVertex AIクライアントを使用
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
```

**Node.js実装での対応**:
- `@google-cloud/vertexai`パッケージを使用
- GCPプロジェクトIDとロケーションが必要
- サービスアカウント認証が必要

### 4.2 代替案1: モデル変更
```javascript
// gemini-2.5-flash → gemini-2.0-flash-exp
const client = new GeminiVideoClient({
  apiKey,
  model: 'gemini-2.0-flash-exp',  // より安定しているモデル
  maxInlineFileBytes: 10 * 1024 * 1024,
});
```

**メリット**: gemini-2.0-flash-expは動画処理が安定
**デメリット**: 最新機能が使えない可能性

### 4.3 代替案2: 動画のダウンロード後にローカルファイルとして処理
```javascript
// 1. YouTube動画をダウンロード（yt-dlp等を使用）
// 2. ローカルファイルとしてアップロード
const result = await client.analyzeLocalVideo({
  filePath: '/path/to/downloaded/video.mp4',
  prompt: 'この動画の内容を要約してください',
});
```

**メリット**: ローカルファイル処理は安定している
**デメリット**: ダウンロード処理が必要、ストレージが必要

### 4.4 代替案3: リトライロジックの追加
```typescript
async analyzeRemoteVideo(input: AnalyzeRemoteVideoInput): Promise<string> {
  const maxRetries = 3;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await this.ai.models.generateContent({
        model,
        contents: createUserContent([
          createPartFromUri(input.videoUrl, "video/mp4"),
          prompt,
        ]),
      });
      return extractText(response);
    } catch (error) {
      if (error.status === 500 && attempt < maxRetries) {
        console.warn(`Attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await delay(retryDelay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 4.5 代替案4: safety_settings の調整
一部の報告では、`safety_settings`パラメータの削除・調整で改善する場合があります。

```typescript
const response = await this.ai.models.generateContent({
  model,
  contents: createUserContent([...]),
  // safety_settingsを明示的に設定しない、またはカスタマイズする
});
```

## 5. 推奨される対応優先度

### 優先度1（高）: Vertex AIへの移行
- **実装工数**: 中〜高
- **安定性**: 高
- **必要なもの**: GCPプロジェクト、サービスアカウント
- **メリット**: 公式に推奨されている方法

### 優先度2（中）: モデル変更
- **実装工数**: 低
- **安定性**: 中
- **変更箇所**: デフォルトモデルを`gemini-2.0-flash-exp`に変更
- **メリット**: 最も簡単な対応

### 優先度3（低）: リトライロジック追加
- **実装工数**: 低
- **安定性**: 低（根本的な解決にはならない）
- **メリット**: 一時的なエラーには対応可能

## 6. 参考リソース

- [Gemini API Troubleshooting Guide](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [GitHub Issue: gemini-2.5-pro vision processing fails](https://github.com/googleapis/python-genai/issues/1304)
- [Forum: 500 error when trying send video from YouTube URL](https://discuss.ai.google.dev/t/500-error-when-trying-send-video-from-youtube-url/60478)
- [Forum: 500 Internal Server Error - Gemini API](https://discuss.ai.google.dev/t/500-internal-server-error-while-trying-with-api/100240)

## 7. 次のアクション

1. **短期対応**: デフォルトモデルを`gemini-2.0-flash-exp`に変更してテスト
2. **中期対応**: Vertex AIの導入を検討（GCP環境がある場合）
3. **長期対応**: リトライロジックとエラーハンドリングの改善
4. **モニタリング**: Google AI Developer Forumで最新の状況を追跡

---

**作成日**: 2025-10-08
**調査範囲**: Gemini API 500エラー、リモート動画解析、YouTube URL処理
