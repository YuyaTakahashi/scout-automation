# BizReach Daily Scout Automation

BizReachのスカウト業務を自動化するツールです。Playwrightでブラウザ操作を行い、OpenAI (GPT-4) で候補者の職務経歴書を評価・選別します。

## 機能

- **自動ログイン**: ローカルで保存したセッション情報 (`auth.json`) を使用。
- **候補者リスト取得**: 指定した検索条件のURLから候補者を巡回。
- **AI評価**: 職務経歴書を解析し、「ミドル/ジュニア判定」「S~Dランク評価」「転職意向度」を判定。
- **スカウト文生成**: 評価がB以上の場合、パーソナライズされたスカウト文面を自動生成。
- **GitHub Actions連携**: 毎日決まった時間に自動実行（予定）。

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数の設定
`.env.example` をコピーして `.env` を作成し、OpenAI APIキーを設定してください。
```bash
cp .env.example .env
# .env を編集して OPENAI_API_KEY を入力
```

### 3. 認証情報の取得
以下のコマンドを実行し、立ち上がったブラウザでBizReachにログインしてください。
完了したらターミナルに戻り、`Enter` を押すとセッション情報が `auth.json` に保存されます。
```bash
npm run auth
```

### 4. 検索条件の設定
`src/scout.ts` の `SEARCH_URL` 定数を、対象としたいBizReachの検索結果URLに変更してください。

## 実行方法

### ドライラン (送信なし・ブラウザ表示あり)
動作確認用です。実際にスカウトは送信されません。
```bash
npm run scout:dry-run
```

### 本番実行 (GitHub Actions用)
ヘッドレスモードで実行されます。
```bash
npm run scout
```

## GitHub Actions 設定

このリポジトリをGitHubにプッシュし、以下のSecretsを設定してください。

| Secret Name      | Description                    |
| ---------------- | ------------------------------ |
| `OPENAI_API_KEY` | OpenAI API Key                 |
| `AUTH_JSON`      | `auth.json` のファイル内容全て |

ワークフローは毎日 9:00 JST に実行されます。
