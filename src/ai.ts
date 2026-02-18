import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn("GEMINI_API_KEY is not set.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

// Schema for Gemini Structured Output
const evaluationSchema = {
    description: "Evaluation result of the candidate",
    type: SchemaType.OBJECT,
    properties: {
        level: {
            type: SchemaType.STRING,
            enum: ["Junior", "Middle", "Unknown"],
            description: "Candidate Level"
        },
        evaluation: {
            type: SchemaType.STRING,
            enum: ["S", "A", "B", "C", "D"],
            description: "Scout Evaluation Rank"
        },
        reason: {
            type: SchemaType.STRING,
            description: "Detailed reason for the evaluation"
        },
        interestLevel: {
            type: SchemaType.STRING,
            enum: ["A", "B", "C"],
            description: "Candidate's interest level in changing jobs"
        },
        interestReason: {
            type: SchemaType.STRING,
            description: "Reason for the interest level evaluation"
        },
        scoutTitle: {
            type: SchemaType.STRING,
            description: "Scout message title (required if evaluation is B or higher)",
            nullable: true
        },
        titleKeyword: {
            type: SchemaType.STRING,
            description: "Attractive keyword to prepend to the job title in brackets (required if evaluation is B or higher)",
            nullable: true
        },
        scoutMessage: {
            type: SchemaType.STRING,
            description: "Scout message body (required if evaluation is B or higher)",
            nullable: true
        }
    },
    required: ["level", "evaluation", "reason", "interestLevel", "interestReason"]
} as any; // Cast to any to avoid strict SchemaType mismatch issues in some SDK versions

const SYSTEM_PROMPT_PREFIX = `
# Role and Goal
あなたは「PdMスカウト候補診断」という、物流企業「オープンロジ」のプロダクトマネージャー（PdM）採用に特化したAIアシスタントです。

# Task
提供された候補者の職務経歴書テキストを分析し、JSONフォーマットで評価結果を出力してください。
`;

const MIDDLE_CRITERIA = `
## ミドル条件 (いずれか必須。満たさない場合はC以下)
条件1: PdM経験が3年以上 かつ 年齢が44歳前半以下
条件2: 物流および製造業のDXコンサルティング経験が3年以上 かつ 年齢が48歳以下

## ジュニア条件 (いずれか必須。満たさない場合はC以下)
条件1: 年齢が33歳以下 かつ PdM未経験（ポテンシャル採用）
条件2: 年齢が33歳以下 かつ PdM経験あり
`;

const EVALUATION_LOGIC = `
## 評価ステップ
1. **Level判定**: 上記条件に基づき Junior/Middle を判定。いずれの条件も満たさない場合は「C」または「D」を前提とする。
2. **スクリーニング (即D評価)**: 
   - 勤務地が「都内・関東近辺」以外
   - ミドル条件を満たさず、かつ年齢が45歳以上
   - ジュニア条件を満たさず、かつ年齢が34歳以上
3. **総合評価 (S-D)**:
   - **B以上の必須条件**: ミドルまたはジュニアの「条件」を少なくとも1つ満たしていること。
   - やりたいこととオープンロジのマッチ度 (物流・SCMへの関心)
   - **BtoB SaaS経験の重視**: BtoB経験があっても「受託開発」「デジタルマーケティング」「Web広告運用」のみの経験者は、プロダクト開発（要件定義・仕様策定）の経験不足とみなし、**評価を必ず1ランク下げる（例: B -> C）**。
   - **未経験ミドルの扱い**: 40代でPdM未経験、または受託のPM経験のみの場合は、原則「C」または「D」とする。診断士資格等があってもPdM実務未経験ならB以上はつけない。
4. **スカウト文作成**: 評価B以上の場合のみ作成。
   - **scoutTitle**: 以下の手順で【キーワード】を作成してください。
     1. **分析**: 候補者の職務経歴から「この人は具体的に何を成し遂げた人か」「何をやりたい人か」を一言で言語化する
     2. **パターン選択**: 以下2パターンのいずれかで作成する
        - **強みベース**: 「〇〇で事業を変える」「〇〇で社会インフラ革新」（〇〇＝候補者が実際にやってきたこと）
        - **Willベース**: 「〇〇PdM求む」「〇〇を一任」（〇〇＝候補者がやりたいこと）
     3. **〇〇の作り方**: 候補者の「具体的な実績・手法」から抽出する。技術名やバズワードの羅列ではなく、「何をどうした人か」が伝わるようにする
        - ✅ 良い例: 「データ分析で顧客育成」「CRM戦略で事業を変える」「新規事業を創るPdM求む」「プロダクト設計を一任」
        - ❌ 悪い例: 「SaaSで物流を革新」「データで事業を変える」→ 候補者でなく会社の話になっている。候補者が「何をした/したい」かが不明
     4. **改善ルール (以下の表現はより具体的な強みに変換すること)**:
        - 「顧客育成で事業変革」 -> 「顧客理解を重視」
        - 「事業課題を解決」 -> 「経営視点の強み重視」
        - 「ECサイトを創る」 -> 「EC事業に強いPdM求む」
        - 「データ分析で投資促進」 -> 「データ分析で物流を革新」
     5. **長さ**: 全角4文字〜12文字程度
     6. **形式**: 【　】で囲むこと
     7. **絶対NG（出力禁止）**:
        - **禁止ワード**: 「グロース」「牽引」「推進」「改善」「投資」は使用禁止。また、「Azure」「AWS」などの特定のサービス名・固有名詞も使用禁止。
        - **禁止パターン**: 「〇〇で物流を革新」「〇〇で物流を変える」→ 候補者個人の話ではなく会社のキャッチコピーになるためNG
        - 「PM経験募集」「物流を変革」→ 汎用的すぎる
        - 使える動詞: 「革新」「一任」「求む」「創る」「変える」（ただし「物流を〜」との組合せはNG）
     8. **出力イメージ**: 【データ分析で顧客育成】【UX設計を一任】【新規事業PdM求む】【CRM戦略で事業を変える】【業務を革新するPdM求む】【プロダクトマネージャー求む】
   - **scoutMessage**: 本文のカスタム部分のみ。宛名は「候補者様」という表現を使い、「〇〇様」などのプレースホルダーや冒頭挨拶（「はじめまして」等）は一切含めないこと。直接本題から始め、候補者の経験や実績に具体的に触れ、オープンロジでの活躍イメージを伝える内容にすること


## コンテキスト情報 (オープンロジ)
- 求める人物像: 「3年後、オープンロジの柱の1人になるレベル」「コトに向かう」「解像度を上げ、言語化する」
- NG: 抽象的な戦略論のみ、実行力不足、他責思考
`;

export type ScoutEvaluation = {
    level: "Junior" | "Middle" | "Unknown";
    evaluation: "S" | "A" | "B" | "C" | "D";
    reason: string;
    interestLevel: "A" | "B" | "C";
    interestReason: string;
    scoutTitle?: string;
    titleKeyword?: string;
    scoutMessage?: string;
};

export async function evaluateCandidate(candidateProfile: string): Promise<ScoutEvaluation> {
    // Use Gemini 1.5 Pro for better reasoning
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-001",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: evaluationSchema,
        }
    });

    const prompt = `
${SYSTEM_PROMPT_PREFIX}
${MIDDLE_CRITERIA}
${EVALUATION_LOGIC}

## Candidate Profile
${candidateProfile}
`;

    try {
        const result = await model.generateContent(prompt);
        const outputText = result.response.text();
        return JSON.parse(outputText) as ScoutEvaluation;
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
}
