# 🎥 MCP Video Understanding

> Gemini APIを活用したビデオ理解機能を提供するModel Context Protocol (MCP) サーバー

## 概要

このプロジェクトは、Gemini APIのマルチモーダル機能を活用し、動画の理解・分析を行うMCPサーバーです。ローカルまたはリモートの動画を分析し、内容を詳細に要約できます。

## 主な機能

✨ **ビデオからの意味理解** - 音声と映像を統合的に分析
🎯 **マルチモーダル分析** - Geminiの高度なAI機能を活用
🔧 **柔軟な設定** - カスタムプロンプトとモデル選択が可能

## 前提条件

- Node.js v18以上
- npm
- Google Cloud の Gemini API キー

## セットアップ

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/shin902/mcp-video-understanding.git
cd mcp-video-understanding

# 依存関係をインストール
npm install

# ビルド
npm run build
```

### API キーの設定

#### macOS / Linux

`~/.zshrc` または `~/.bashrc` にAPIキーを設定してください：

```bash
export GOOGLE_API_KEY="your_api_key_here"
```

サーバーは自動的に `~/.zshrc` からキーを読み取ります。

#### Windows

**コマンドプロンプト (cmd) の場合：**

一時的な設定（現在のセッションのみ有効）：
```cmd
set GOOGLE_API_KEY=your_api_key_here
```

永続的な設定：
```cmd
setx GOOGLE_API_KEY "your_api_key_here"
```

**PowerShell の場合：**

一時的な設定（現在のセッションのみ有効）：
```powershell
$env:GOOGLE_API_KEY="your_api_key_here"
```

永続的な設定：
```powershell
[System.Environment]::SetEnvironmentVariable('GOOGLE_API_KEY', 'your_api_key_here', 'User')
```

> **注意**: 永続的な設定後は、新しいターミナルウィンドウを開いて設定を反映してください。

### MCP クライアントの設定（Claude Desktopの場合）

#### 設定ファイルの場所

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

#### 設定内容

**基本設定 (macOS / WSL含むLinux):**

Claude Desktop などのMCPクライアントで使用する場合、設定ファイルに以下を追加：

```json
{
  "mcpServers": {
    "gemini-video": {
      "command": "npx",
      "args": ["mcp-video-understanding"],
      "env": {
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Windows (cmd経由で実行する場合):**

```json
{
  "mcpServers": {
    "gemini-video": {
      "command": "cmd",
      "args": ["/c", "npx", "mcp-video-understanding"],
      "env": {
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

> **注意**: `/c` オプションは「コマンドを実行して終了」を意味します。

**セキュリティ重視の設定:**

APIキーを設定ファイルに直接書きたくない場合は、`env` を空にしてシェル環境変数を使用：

```json
{
  "mcpServers": {
    "gemini-video": {
      "command": "npx",
      "args": ["mcp-video-understanding"],
      "env": {}
    }
  }
}
```

#### npx のパス確認方法

**macOS / Linux:**
```bash
which npx
```
- 一般的: `/usr/local/bin/npx`
- Apple Silicon (Homebrew): `/opt/homebrew/bin/npx`
- mise使用時: `/Users/your-username/.local/share/mise/shims/npx`

**Windows:**
```cmd
where.exe npx
```
- 一般的: `C:\Program Files\nodejs\npx.cmd`
- npm グローバルインストール: `C:\Users\your-username\AppData\Roaming\npm\npx.cmd`

> **注意**: 環境によっては `npx` のフルパスが必要です。上記のコマンドで確認してください。

## 使用方法

### スタンドアロン実行

```bash
npm start
```

### 利用可能なツール

#### 📹 `analyzeLocalVideo`

ローカルの動画ファイルを分析します（最大20MB）。

**デフォルトプロンプト**:
```
最初にこの記事全体を要約し全体像を掴んだ後、大きなセクションごとに細かく要約を行ってください。
その次に小さなセクションごとに更に詳細な要約を行ってください。
```

カスタムプロンプトを指定することも可能です。

#### 🌐 `analyzeRemoteVideo`

公開URLの動画を分析します。使用方法は `analyzeLocalVideo` と同様です。

**YouTube動画の制限**:
- ❌ 非公開動画
- ❌ 限定公開動画
- ❌ 配信のアーカイブ
- ✅ 完全に公開されている動画のみ対応

### 対応する動画形式

Geminiのマルチモーダル動画理解により、以下の形式に対応：

- 🎤 **音声付き解説動画** - 講義、チュートリアルなど
- 🎬 **音声なし動画** - 映像のみのコンテンツ
- 🎵 **Music Video** - 映像がメインの動画

### 使用モデル

| モデル | 特徴 |
|--------|------|
| `gemini-2.5-flash` (デフォルト) | 高速かつバランスの取れた性能 |
| `gemini-2.5-pro` | より高度な分析が可能 |
| `gemini-2.5-flash-lite` | 軽量で高速 |

## 開発

```bash
# 開発モードで実行
npm run dev

# テスト実行
npm test

# ビルド
npm run build
```

ビルドされたファイルは `build/` ディレクトリに出力されます。

## コントリビューション

プルリクエストは歓迎します！大きな変更を行う前に、まずissueで議論してください。

## ライセンス

MIT
