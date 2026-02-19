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
   - **B以上の必須要件**:
     - **ミドル層**: 「B2B SaaSプロダクトの開発経験」または「ITプロダクトの要件定義・仕様策定の実務経験」が必須。これがない場合は一律C以下とする。
     - **ジュニア層**: PdM実務経験は必須ではない。ただし、事業企画、営業、CS、エンジニア等の実務において「コトに向かう姿勢」や「業務の解像度を上げる能力」が見込まれる場合はB以上の対象とする。
   - **ドメインによる制限 (全レベル共通)**: 
     - 職種名が「PdM」であり「要件定義」の実績があっても、**ドメインが「広告(アドテク)」「マーケティング」「会計」「教育」「ゲーム」等、オープンロジ（物流・SCM）と関連性が低い職務経験のみ**の場合は、評価を **必ずC以下** にする。
   - **BtoB SaaS経験の重視**: 
     - 「受託開発」「事業開発(BizDev)」「営業」「デジタルマーケティング」「グロースハック」「Web広告運用」「広告システム開発管理」「アドテク(AdTech)」のみの経験で、上記の「物流・SCM関連ドメイン」への関与が薄い場合は、評価を **必ずC以下** にする。
   - **エンジニアキャリア層の制限**: 
     - 経歴の大部分がエンジニアであり、職務要約や自己PRにおいて「要件定義」「仕様策定」「事業貢献」「顧客課題の解決」への関心が薄く、技術追求（実装）のみに特化している場合は、レベルに関わらず **必ずC以下** にする。
   - **未経験ミドルの扱い**: 40代でPdM実務未経験、または受託のPM経験のみの場合は、原則「C」または「D」とする。診断士資格・事業開発実績があっても、B2B SaaS領域での実績がなければB以上はつけない。
 4. **スカウト文作成**: 評価B以上の場合のみ作成。
    - **scoutTitle / titleKeyword**: 
      - **【最優先・絶対遵守】禁止ワード(いかなる文脈でも出力禁止)**: 「SaaS」「グロース」「牽引」「推進」「改善」「投資」「会計」「広告」「海外事業」「海外」「グローバル」「Overseas」「Global」は、scoutTitleおよびtitleKeywordに **絶対に使用しないでください**。
       - **キーワード作成手順**:
         1. **特重視关键词**: 「新規立ち上げ」「0→1」「スクラム開発」「アジャイル」「B2Bの深掘り」に加え、**「UX」「データ分析」「事業開発」「基盤設計」などの「具体的手段(How)」と「成果(Outcome)」を組み合わせた表現**を最優先してください。
         2. **抽象的表現の禁止**: **「事業を創る」「PMFを追求」「事業に挑む」といった単独の表現は、候補者が何をすべきか不明瞭なため絶対禁止**です。
         3. **組み合わせの必須化**: 「事業」や「PMF」という言葉を使う場合は、**必ず候補者の具体的な強み(A)と組み合わせて「Aで事業を創る」「AでPMFを構築」といった形式**にしてください。
         4. **分析**: 候補者の職務経歴から「この人の具体的な武器（UX, データ分析, スクラム等）」を抽出し、それを使って「何を成し遂げたい/成し遂げてほしいか」を言語化する。
         5. **パターン例**: 「AでBを実現」「AでBを創る」「A PdM求む」「Aを一任」
         6. **〇〇の作り方**: 
            - ✅ 良い例: 【UXでPMFを追求】【データ分析で事業を創る】【スクラムで0→1を創る】【UX設計でPMFを構築】【B2Bの課題をUXで紐解く】
            - ❌ 悪い例(単独/抽象的/NG語): 【事業を創る】【PMFを追求】【PMFを支援】【システム開発を担当】【SaaSプロダクト改善】
         6. **長さ・形式**: 全角4文字〜12文字程度。【　】で囲むこと。
         7. **絶対禁止パターン**: 「〇〇で物流を革新」「〇〇で物流を変える」「PM経験募集」「物流を変革」
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
