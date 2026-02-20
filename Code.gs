/**
 * HERP API - 応募一覧取得 & スプレッドシート書き出しスクリプト
 * 
 * 設定方法:
 * 1. スクリプトプロパティに HERP_API_TOKEN を設定してください
 * 2. スクリプトプロパティに HERP_SHEET_NAME を設定してください（省略時はデフォルト値を使用）
 * 3. スプレッドシートIDを SPREADSHEET_ID に設定するか、バインドされたスプレッドシートを使用してください
 */

// ===== 設定 =====
const CONFIG = {
  // HERP API設定
  API_BASE_URL: 'https://public-api.herp.cloud/hire/v1',
  
  // HERP Hire 管理画面のURL（応募詳細ページへのリンク用）
  HERP_HIRE_BASE_URL: 'https://openlogi.v1.herp.cloud',
  
  // 対象の職種ID
  REQUISITION_IDS: [
    '4ee22d29-8fde-401e-bf9e-779c8846b0f1',
    '3fd5cd94-b587-49c8-b186-5efa95ff19ec',
    'b03f6476-2213-4040-826e-d1d5c04094fb',
    'e5095e5c-e15a-42fa-bb25-98ced0dabd1e'
  ],
  
  // ソート設定
  SORT_FIELD: 'appliedAt',
  SORT_DIRECTION: 'desc',
  
  // ページ数上限（0で全ページ取得）
  MAX_PAGES: 0,
  
  // 同期モード: 'all' = 全件取得, 'recent' = 直近1週間の選考ステップ更新のみ
  SYNC_MODE: 'all',
  
  // スプレッドシートのシート名（デフォルト値、スクリプトプロパティ HERP_SHEET_NAME で上書き可能）
  SHEET_NAME: 'シート85'
};

// スプレッドシートのヘッダー定義
const HEADERS = [
  'ID',
  '応募詳細URL',
  '名前',
  'ステータス',
  '職種ID',
  '応募日',
  '選考ステップ',
  '選考ステップ更新日',
  'カジュアル面談予定日',
  'カジュアル面談評価',
  'カジュアル面談担当者',
  '1次面接予定日',
  '1次面接評価',
  '1次面接担当者',
  '2次面接予定日',
  '2次面接評価',
  '2次面接担当者',
  '最終面接予定日',
  '最終面接担当者',
  'オファー面談予定日',
  'メールアドレス',
  '電話番号',
  '年齢',
  '会社',
  'チャネルタイプ',
  'チャネル種別',
  'チャネル説明',
  '学歴',
  '経歴',
  'ノート',
  'タグ',
  'リンク',
  '選考終了理由',
  '選考終了日',
  '担当者',
  '更新日時'
];

// 面接予定日の検索キーワード（stepフィールドの値）
const INTERVIEW_STEPS = {
  casualInterview: 'casualInterview',
  firstInterview: 'firstInterview',
  secondInterview: 'secondInterview',
  thirdInterview: 'thirdInterview',
  finalInterview: 'finalInterview',
  offerMeeting: 'offer'  // オファー面談の場合
};

// タイトルでの部分一致検索用キーワード（予備）
const INTERVIEW_KEYWORDS = {
  casualInterview: ['カジュアル面談', 'カジュアル'],
  firstInterview: ['一次面接', '1次面接'],
  secondInterview: ['二次面接', '2次面接'],
  thirdInterview: ['三次面接', '3次面接'],
  finalInterview: ['最終面接'],
  offerMeeting: ['オファー面談', 'オファー']
};

// 選考ステップの日本語変換マップ
const STEP_JAPANESE = {
  'entry': 'エントリー',
  'resumeScreening': '書類選考',
  'casualInterview': 'カジュアル面談',
  'firstInterview': '1次面接',
  'secondInterview': '2次面接',
  'thirdInterview': '3次面接',
  'finalInterview': '最終面接',
  'offer': 'オファー',
  'hired': '内定承諾',
  'rejected': 'お見送り',
  'declined': '辞退'
};

// 評価の日本語表示マップ
const EVALUATION_LABELS = {
  'S': 'S：是非採用したい',
  'A': 'A：採用したい',
  'B': 'B：前向きに検討したい',
  'C': 'C：見極めが必要',
  'D': 'D：他部署で可能性あり',
  'NG': 'NG：お見送り'
};

/**
 * メイン関数: HERP APIから応募一覧を取得してスプレッドシートに書き出す
 */
function syncCandidacies() {
  try {
    Logger.log('応募一覧の同期を開始します...');
    
    // APIキーの取得
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('HERP_API_TOKEN がスクリプトプロパティに設定されていません');
    }
    
    // 全ての応募データを取得
    const allCandidacies = fetchAllCandidacies(apiKey);
    Logger.log(`取得した応募数: ${allCandidacies.length}`);
    
    // 各応募のコンタクト情報と詳細情報を取得
    Logger.log('コンタクト情報・詳細情報を取得中...');
    for (let i = 0; i < allCandidacies.length; i++) {
      const candidacy = allCandidacies[i];
      
      // コンタクト情報を取得（面接予定日・評価・担当者）
      const interviewData = fetchInterviewDates(apiKey, candidacy.id);
      candidacy.interviewDates = interviewData.dates;
      candidacy.evaluations = interviewData.evaluations;
      candidacy.attendeeIds = interviewData.attendeeIds;
      
      // 詳細情報を取得（リンク）
      const details = fetchCandidacyDetails(apiKey, candidacy.id);
      candidacy.links = details.links || [];
      
      // 進捗ログ（10件ごと）
      if ((i + 1) % 10 === 0) {
        Logger.log('取得進捗: ' + (i + 1) + '/' + allCandidacies.length);
      }
      
      // レートリミット対策: 1200ms待機（2リクエスト/応募なので1分間約50応募）
      Utilities.sleep(1200);
    }
    
    // スプレッドシートに書き出し（Insert/Update方式）
    upsertCandidaciesToSheet(allCandidacies);
    
    // 実行時刻を保存（incremental同期用）
    saveLastSyncTime();
    
    Logger.log('同期が完了しました');
  } catch (error) {
    Logger.log(`エラーが発生しました: ${error.message}`);
    throw error;
  }
}

/**
 * スクリプトプロパティからAPIキーを取得
 */
function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('HERP_API_TOKEN');
}

/**
 * 前回同期時刻を取得
 * @returns {string|null} 前回同期時刻（yyyy-MM-dd形式）
 */
function getLastSyncTime() {
  return PropertiesService.getScriptProperties().getProperty('LAST_SYNC_TIME');
}

/**
 * 同期時刻を保存
 */
function saveLastSyncTime() {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  PropertiesService.getScriptProperties().setProperty('LAST_SYNC_TIME', dateStr);
  Logger.log('同期時刻を保存しました: ' + dateStr);
}

/**
 * HERP APIから全ての応募データを取得（ページネーション対応）
 * @param {string} apiKey - HERP APIキー
 * @returns {Object[]} 全応募データの配列
 */
function fetchAllCandidacies(apiKey) {
  const allCandidacies = [];
  
  // 各職種IDごとにデータを取得
  for (const requisitionId of CONFIG.REQUISITION_IDS) {
    Logger.log(`職種ID: ${requisitionId} の応募を取得中...`);
    const candidacies = fetchCandidaciesByRequisition(apiKey, requisitionId);
    allCandidacies.push(...candidacies);
  }
  
  // IDで重複を除去（複数の職種に応募している場合を考慮）
  const uniqueCandidacies = removeDuplicates(allCandidacies, 'id');
  
  return uniqueCandidacies;
}

/**
 * 特定の職種IDの応募データを取得
 * @param {string} apiKey - HERP APIキー
 * @param {string} requisitionId - 職種ID
 * @returns {Object[]} 応募データの配列
 */
function fetchCandidaciesByRequisition(apiKey, requisitionId) {
  const candidacies = [];
  let page = 1;
  let hasNextPage = true;
  const maxPages = CONFIG.MAX_PAGES || 0; // 0で無制限
  
  while (hasNextPage && (maxPages === 0 || page <= maxPages)) {
    const response = fetchCandidaciesPage(apiKey, requisitionId, page);
    candidacies.push(...response.candidacies);
    hasNextPage = response.hasNextPage;
    page++;
    
    // レートリミット対策: 100ms待機
    Utilities.sleep(100);
  }
  
  return candidacies;
}

/**
 * HERP APIから1ページ分の応募データを取得
 * @param {string} apiKey - HERP APIキー
 * @param {string} requisitionId - 職種ID
 * @param {number} page - ページ番号
 * @returns {Object} APIレスポンス
 */
function fetchCandidaciesPage(apiKey, requisitionId, page) {
  const queryParams = [
    'sort=' + encodeURIComponent(CONFIG.SORT_FIELD),
    'direction=' + encodeURIComponent(CONFIG.SORT_DIRECTION),
    'requisitionId=' + encodeURIComponent(requisitionId),
    'page=' + page
  ];
  
  // recentモードの場合は直近1週間 + バッファ14日（計21日前）でフィルター
  if (CONFIG.SYNC_MODE === 'recent') {
    const today = new Date();
    // 基準日(7日前)からさらに14日遡る -> 21日前
    const startDateDate = new Date(today.getTime() - (7 + 14) * 24 * 60 * 60 * 1000);
    const startDate = Utilities.formatDate(startDateDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    const endDate = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
    queryParams.push('stepUpdatedAtFrom=' + startDate);
    queryParams.push('stepUpdatedAtTo=' + endDate);
  }
  
  // incrementalモードの場合は前回実行時刻 + バッファ14日（つまり前回実行日の14日前から）でフィルター
  if (CONFIG.SYNC_MODE === 'incremental') {
    const lastSyncTime = getLastSyncTime();
    if (lastSyncTime) {
      const today = new Date();
      
      // 前回実行日から14日遡る
      const lastSyncDate = new Date(lastSyncTime);
      lastSyncDate.setDate(lastSyncDate.getDate() - 14);
      
      const startDate = Utilities.formatDate(lastSyncDate, 'Asia/Tokyo', 'yyyy-MM-dd');
      const endDate = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
      queryParams.push('stepUpdatedAtFrom=' + startDate);
      queryParams.push('stepUpdatedAtTo=' + endDate);
    }
  }
  
  const url = CONFIG.API_BASE_URL + '/candidacies?' + queryParams.join('&');
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  
  if (statusCode !== 200) {
    const errorBody = response.getContentText();
    throw new Error('API Error (' + statusCode + '): ' + errorBody);
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * 応募のコンタクト一覧を取得して面接予定日を抽出
 * @param {string} apiKey - HERP APIキー
 * @param {string} candidacyId - 応募ID
 * @returns {Object} 面接予定日のオブジェクト
 */
function fetchInterviewDates(apiKey, candidacyId) {
  const result = {
    dates: {
      casualInterview: '',
      firstInterview: '',
      secondInterview: '',
      finalInterview: '',
      offerMeeting: ''
    },
    evaluations: {
      casualInterview: '',
      firstInterview: '',
      secondInterview: ''
    },
    attendeeIds: {
      casualInterview: [],
      firstInterview: [],
      secondInterview: [],
      finalInterview: [],
      offerMeeting: []
    }
  };
  
  try {
    const contacts = fetchContacts(apiKey, candidacyId);
    
    for (const contact of contacts) {
      const step = contact.step;
      
      // 予定日と担当者の取得
      let title = '';
      if (contact.assessmentSchedule && contact.assessmentSchedule.schedule) {
        title = contact.assessmentSchedule.title || '';
        const startsAt = contact.assessmentSchedule.schedule.startsAt;
        const attendees = contact.assessmentSchedule.attendeeIds || [];
        
        // stepフィールドで判定（優先）
        if (step === INTERVIEW_STEPS.casualInterview && !result.dates.casualInterview) {
          result.dates.casualInterview = formatDateTime(startsAt);
          result.attendeeIds.casualInterview = attendees;
        } else if (step === INTERVIEW_STEPS.firstInterview && !result.dates.firstInterview) {
          result.dates.firstInterview = formatDateTime(startsAt);
          result.attendeeIds.firstInterview = attendees;
        } else if (step === INTERVIEW_STEPS.secondInterview && !result.dates.secondInterview) {
          result.dates.secondInterview = formatDateTime(startsAt);
          result.attendeeIds.secondInterview = attendees;
        } else if (step === INTERVIEW_STEPS.thirdInterview && !result.dates.secondInterview) {
          result.dates.secondInterview = formatDateTime(startsAt);
          result.attendeeIds.secondInterview = attendees;
        } else if (step === INTERVIEW_STEPS.finalInterview && !result.dates.finalInterview) {
          result.dates.finalInterview = formatDateTime(startsAt);
          result.attendeeIds.finalInterview = attendees;
        } else if (step === INTERVIEW_STEPS.offerMeeting && !result.dates.offerMeeting) {
          result.dates.offerMeeting = formatDateTime(startsAt);
          result.attendeeIds.offerMeeting = attendees;
        } else {
          // stepでマッチしない場合はタイトルで検索
          if (!result.dates.casualInterview && matchesKeywords(title, INTERVIEW_KEYWORDS.casualInterview)) {
            result.dates.casualInterview = formatDateTime(startsAt);
            result.attendeeIds.casualInterview = attendees;
          } else if (!result.dates.firstInterview && matchesKeywords(title, INTERVIEW_KEYWORDS.firstInterview)) {
            result.dates.firstInterview = formatDateTime(startsAt);
            result.attendeeIds.firstInterview = attendees;
          } else if (!result.dates.secondInterview && matchesKeywords(title, INTERVIEW_KEYWORDS.secondInterview)) {
            result.dates.secondInterview = formatDateTime(startsAt);
            result.attendeeIds.secondInterview = attendees;
          } else if (!result.dates.secondInterview && matchesKeywords(title, INTERVIEW_KEYWORDS.thirdInterview)) {
            result.dates.secondInterview = formatDateTime(startsAt);
            result.attendeeIds.secondInterview = attendees;
          } else if (!result.dates.finalInterview && matchesKeywords(title, INTERVIEW_KEYWORDS.finalInterview)) {
            result.dates.finalInterview = formatDateTime(startsAt);
            result.attendeeIds.finalInterview = attendees;
          } else if (!result.dates.offerMeeting && matchesKeywords(title, INTERVIEW_KEYWORDS.offerMeeting)) {
            result.dates.offerMeeting = formatDateTime(startsAt);
            result.attendeeIds.offerMeeting = attendees;
          }
        }
      }
      
      // 評価の取得（カジュアル面談、1次面接、2次面接のみ）
      if (contact.evaluations && contact.evaluations.length > 0) {
        // タイトルも考慮して評価キーを取得
        const evalKey = getEvaluationKey(step, title);
        if (evalKey && !result.evaluations[evalKey]) {
          // 完了した評価を探す
          const completedEval = contact.evaluations.find(function(e) { return e.status === 'completed'; });
          if (completedEval) {
            Utilities.sleep(700); // レートリミット対策
            const evalDetails = fetchEvaluationDetails(apiKey, completedEval.id);
            if (evalDetails && evalDetails.evaluationForm && evalDetails.evaluationForm.items) {
              const firstItem = evalDetails.evaluationForm.items[0];
              if (firstItem && firstItem.answer && firstItem.answer.length > 0) {
                // 総評の回答を取得（S:, A:, B:, C:, D:, NG: の最初の文字を抽出）
                const answer = firstItem.answer[0];
                const grade = answer.split('：')[0] || answer.split(':')[0] || answer;
                result.evaluations[evalKey] = grade;
              }
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('コンタクト/評価取得エラー (candidacyId: ' + candidacyId + '): ' + e.message);
  }
  
  return result;
}

/**
 * stepまたはtitleから評価キーを取得
 * stepで判定できない場合はtitleのキーワードマッチングを試みる
 * @param {string} step - stepフィールド
 * @param {string} title - (optional) タイトル
 * @returns {string|null} 評価キー
 */
function getEvaluationKey(step, title) {
  // stepでの判定（優先）
  if (step === INTERVIEW_STEPS.casualInterview) return 'casualInterview';
  if (step === INTERVIEW_STEPS.firstInterview) return 'firstInterview';
  if (step === INTERVIEW_STEPS.secondInterview || step === INTERVIEW_STEPS.thirdInterview) return 'secondInterview';
  
  // titleでの判定（フォールバック）
  if (title) {
    if (matchesKeywords(title, INTERVIEW_KEYWORDS.casualInterview)) return 'casualInterview';
    if (matchesKeywords(title, INTERVIEW_KEYWORDS.firstInterview)) return 'firstInterview';
    if (matchesKeywords(title, INTERVIEW_KEYWORDS.secondInterview)) return 'secondInterview';
    if (matchesKeywords(title, INTERVIEW_KEYWORDS.thirdInterview)) return 'secondInterview';
  }
  
  return null;
}

/**
 * タイトルがキーワード配列のいずれかを含むかチェック
 * @param {string} title - タイトル
 * @param {string[]} keywords - キーワード配列
 * @returns {boolean}
 */
function matchesKeywords(title, keywords) {
  for (var i = 0; i < keywords.length; i++) {
    if (title.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * 応募の詳細情報を取得（linksなど一覧APIに含まれない情報）
 * @param {string} apiKey - HERP APIキー
 * @param {string} candidacyId - 応募ID
 * @returns {Object} 詳細情報
 */
function fetchCandidacyDetails(apiKey, candidacyId) {
  const url = CONFIG.API_BASE_URL + '/candidacies/' + candidacyId;
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  
  if (statusCode !== 200) {
    Logger.log('詳細API エラー (candidacyId: ' + candidacyId + '): ' + statusCode);
    return { links: [] };
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * 応募のコンタクト一覧を取得
 * @param {string} apiKey - HERP APIキー
 * @param {string} candidacyId - 応募ID
 * @returns {Object[]} コンタクト一覧
 */
function fetchContacts(apiKey, candidacyId) {
  const url = CONFIG.API_BASE_URL + '/candidacies/' + candidacyId + '/contacts';
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  
  if (statusCode !== 200) {
    Logger.log('コンタクトAPI エラー (candidacyId: ' + candidacyId + '): ' + statusCode);
    return []; // エラー時は空配列を返す
  }
  
  const data = JSON.parse(response.getContentText());
  return data.contacts || [];
}

// 指定メンバーのIDマップ（ハードコード）
// 高橋祐哉: U-51VV5
// 西田: U-752OQ
// 安藤慎太郎: U-PVZNP
// 小上馬: U-754PL
// 北島: U-XZGK1
// 岡田智成: U-3ZYG3
const MEMBER_MAP = {
  'U-51VV5': '高橋祐哉',
  'U-752OQ': '西田',
  'U-PVZNP': '安藤慎太郎',
  'U-754PL': '小上馬',
  'U-XZGK1': '北島',
  'U-3ZYG3': '岡田智成',
  'U-RM04D': '伊藤秀嗣'
};

/**
 * attendeeIdsを名前のカンマ区切り文字列に変換
 * 指定されたメンバー以外は「その他」と表示
 * @param {string[]} attendeeIds - attendeeId配列
 * @returns {string} 名前のカンマ区切り文字列
 */
function attendeeIdsToNames(attendeeIds) {
  if (!attendeeIds || attendeeIds.length === 0) {
    return '';
  }
  
  const names = [];
  let hasOther = false;
  
  attendeeIds.forEach(function(id) {
    const name = MEMBER_MAP[id];
    if (name) {
      names.push(name);
    } else {
      hasOther = true;
    }
  });
  
  if (hasOther) {
    names.push('その他');
  }
  
  // 重複を除去（指定メンバーとその他）
  return Array.from(new Set(names)).join(', ');
}

/**
 * 評価の詳細情報を取得
 * @param {string} apiKey - HERP APIキー
 * @param {string} evaluationId - 評価ID
 * @returns {Object} 評価詳細
 */
function fetchEvaluationDetails(apiKey, evaluationId) {
  const url = CONFIG.API_BASE_URL + '/evaluations/' + evaluationId;
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  
  if (statusCode !== 200) {
    Logger.log('評価API エラー (evaluationId: ' + evaluationId + '): ' + statusCode);
    return null;
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * デバッグ用: channel.type が media の応募者データを確認する
 */
function debugMediaChannel() {
  const apiKey = getApiKey();
  if (!apiKey) {
    Logger.log('HERP_API_TOKEN が設定されていません');
    return;
  }
  
  // 全職種IDから応募を取得してmediaチャネルを探す
  for (const requisitionId of CONFIG.REQUISITION_IDS) {
    Logger.log('=== 職種ID: ' + requisitionId + ' ===');
    const response = fetchCandidaciesPage(apiKey, requisitionId, 1);
    
    if (!response.candidacies || response.candidacies.length === 0) {
      Logger.log('応募なし');
      continue;
    }
    
    for (const candidacy of response.candidacies) {
      if (candidacy.channel && candidacy.channel.type === 'media') {
        Logger.log('=== mediaチャネル発見! 応募者: ' + candidacy.name + ' ===');
        Logger.log('一覧API - channel: ' + JSON.stringify(candidacy.channel, null, 2));
        
        // 詳細APIも呼び出す
        Utilities.sleep(700);
        const details = fetchCandidacyDetails(apiKey, candidacy.id);
        Logger.log('詳細API - 全データ: ' + JSON.stringify(details, null, 2));
        Logger.log('詳細API - channel: ' + JSON.stringify(details.channel, null, 2));
        Logger.log('詳細API - links: ' + JSON.stringify(details.links, null, 2));
        
        return; // 見つかったら終了
      }
    }
  }
  
  Logger.log('mediaチャネルの応募者が見つかりませんでした');
}

/**
 * 配列から重複を除去
 * @param {Object[]} array - 対象配列
 * @param {string} key - 重複判定に使うキー
 * @returns {Object[]} 重複を除去した配列
 */
function removeDuplicates(array, key) {
  const seen = new Set();
  return array.filter(item => {
    if (seen.has(item[key])) {
      return false;
    }
    seen.add(item[key]);
    return true;
  });
}

/**
 * 応募データをスプレッドシートにInsert/Update方式で書き出す
 * @param {Object[]} candidacies - 応募データの配列
 */
function upsertCandidaciesToSheet(candidacies) {
  const sheet = getOrCreateSheet();
  
  // 既存データのIDマップを作成
  const existingData = getExistingDataMap(sheet);
  
  // 新規追加と更新のデータを分類
  const toInsert = [];
  const toUpdate = [];
  
  for (const candidacy of candidacies) {
    const row = candidacyToRow(candidacy);
    const id = candidacy.id;
    
    if (existingData.has(id)) {
      toUpdate.push({ rowNum: existingData.get(id), data: row });
    } else {
      toInsert.push(row);
    }
  }
  
  // 更新処理
  for (const update of toUpdate) {
    sheet.getRange(update.rowNum, 1, 1, HEADERS.length).setValues([update.data]);
  }
  Logger.log(`更新した行数: ${toUpdate.length}`);
  
  // 新規追加処理（ヘッダー直下に挿入）
  if (toInsert.length > 0) {
    // 2行目に新しい行を挿入
    sheet.insertRowsAfter(1, toInsert.length);
    sheet.getRange(2, 1, toInsert.length, HEADERS.length).setValues(toInsert);
  }
  Logger.log(`追加した行数: ${toInsert.length}`);
}

/**
 * シートを取得または作成
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} シート
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // スクリプトプロパティからシート名を取得（未設定時はCONFIGのデフォルト値を使用）
  const sheetName = PropertiesService.getScriptProperties().getProperty('HERP_SHEET_NAME') || CONFIG.SHEET_NAME;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  // ヘッダーが設定されていない場合は設定する
  const firstCell = sheet.getRange(1, 1).getValue();
  if (!firstCell || firstCell !== HEADERS[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  
  return sheet;
}

/**
 * 既存データからIDと行番号のマップを作成
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - シート
 * @returns {Map<string, number>} IDをキー、行番号を値とするマップ
 */
function getExistingDataMap(sheet) {
  const map = new Map();
  const lastRow = sheet.getLastRow();
  
  if (lastRow <= 1) {
    return map; // ヘッダーのみの場合
  }
  
  // ID列（1列目）のデータを取得
  const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
  const ids = idRange.getValues();
  
  ids.forEach((row, index) => {
    const id = row[0];
    if (id) {
      map.set(id, index + 2); // 行番号（2行目から開始）
    }
  });
  
  return map;
}

/**
 * 応募データをスプレッドシートの行データに変換
 * @param {Object} candidacy - 応募データ
 * @returns {any[]} 行データ
 */
function candidacyToRow(candidacy) {
  const detailUrl = CONFIG.HERP_HIRE_BASE_URL + '/ats/p/candidacies/id/' + candidacy.id + '#detail';
  const interviewDates = candidacy.interviewDates || {};
  const evaluations = candidacy.evaluations || {};
  const attendeeIds = candidacy.attendeeIds || {};
  
  // 選考ステップを日本語に変換
  const stepJa = STEP_JAPANESE[candidacy.step] || candidacy.step || '';
  
  // 評価を日本語ラベルに変換
  const casualEval = evaluations.casualInterview ? (EVALUATION_LABELS[evaluations.casualInterview] || evaluations.casualInterview) : '';
  const firstEval = evaluations.firstInterview ? (EVALUATION_LABELS[evaluations.firstInterview] || evaluations.firstInterview) : '';
  const secondEval = evaluations.secondInterview ? (EVALUATION_LABELS[evaluations.secondInterview] || evaluations.secondInterview) : '';
  
  // 担当者を名前に変換
  const casualAttendees = attendeeIdsToNames(attendeeIds.casualInterview);
  const firstAttendees = attendeeIdsToNames(attendeeIds.firstInterview);
  const secondAttendees = attendeeIdsToNames(attendeeIds.secondInterview);
  const finalAttendees = attendeeIdsToNames(attendeeIds.finalInterview);
  
  return [
    candidacy.id || '',
    detailUrl,
    candidacy.name || '',
    candidacy.status || '',
    candidacy.requisitionId || '',
    candidacy.appliedAt ? formatDateTime(candidacy.appliedAt) : '',
    stepJa,
    candidacy.stepUpdatedAt ? formatDateTime(candidacy.stepUpdatedAt) : '',
    interviewDates.casualInterview || '',
    casualEval,
    casualAttendees,
    interviewDates.firstInterview || '',
    firstEval,
    firstAttendees,
    interviewDates.secondInterview || '',
    secondEval,
    secondAttendees,
    interviewDates.finalInterview || '',
    finalAttendees,
    interviewDates.offerMeeting || '',
    candidacy.email || '',
    candidacy.telephoneNumber || '',
    candidacy.age || '',
    candidacy.company || '',
    candidacy.channel ? candidacy.channel.type : '',
    getChannelKind(candidacy.channel),
    getChannelDescription(candidacy.channel),
    candidacy.education || '',
    candidacy.career || '',
    candidacy.note || '',
    Array.isArray(candidacy.tags) ? candidacy.tags.join(', ') : '',
    Array.isArray(candidacy.links) ? candidacy.links.join(', ') : '',
    candidacy.terminationReason || '',
    candidacy.terminatedAt ? formatDateTime(candidacy.terminatedAt) : '',
    Array.isArray(candidacy.operators) ? candidacy.operators.join(', ') : '',
    candidacy.updatedAt ? formatDateTime(candidacy.updatedAt) : ''
  ];
}

/**
 * ISO 8601形式の日時を日本時間のフォーマットに変換
 * @param {string} isoString - ISO 8601形式の日時文字列
 * @returns {string} フォーマット済み日時文字列
 */
function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  } catch (e) {
    return isoString;
  }
}

/**
 * チャネル種別を取得
 * @param {Object} channel - チャネルオブジェクト
 * @returns {string} チャネル種別
 */
function getChannelKind(channel) {
  if (!channel) return '';
  
  // mediaの場合はスカウトかどうかを表示
  if (channel.type === 'media') {
    return channel.isScout ? 'スカウト' : '応募';
  }
  
  // それ以外はkindを返す
  return channel.kind || '';
}

/**
 * チャネル説明を取得（媒体名または説明）
 * @param {Object} channel - チャネルオブジェクト
 * @returns {string} チャネル説明
 */
function getChannelDescription(channel) {
  if (!channel) return '';
  
  // mediaの場合はmediaNameを返す
  if (channel.type === 'media' && channel.mediaName) {
    return channel.mediaName;
  }
  
  // それ以外はdescriptionを返す
  return channel.description || '';
}

/**
 * スプレッドシートのメニューにカスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('HERP連携')
    .addItem('全件同期', 'syncAll')
    .addItem('直近1週間のみ同期', 'syncRecent')
    .addItem('差分同期（前回以降のみ）', 'syncIncremental')
    .addSeparator()
    .addItem('APIキーを設定', 'promptForApiKey')
    .addToUi();
}

/**
 * 全件同期モードで実行
 */
function syncAll() {
  CONFIG.SYNC_MODE = 'all';
  Logger.log('同期モード: 全件取得');
  syncCandidacies();
}

/**
 * 直近1週間モードで実行
 */
function syncRecent() {
  CONFIG.SYNC_MODE = 'recent';
  Logger.log('同期モード: 直近1週間の選考ステップ更新のみ');
  syncCandidacies();
}

/**
 * 差分同期モードで実行（前回同期以降の更新のみ）
 */
function syncIncremental() {
  const lastSync = getLastSyncTime();
  if (!lastSync) {
    Logger.log('前回同期時刻がありません。全件同期を実行します。');
    CONFIG.SYNC_MODE = 'all';
  } else {
    CONFIG.SYNC_MODE = 'incremental';
    Logger.log('同期モード: 差分同期（' + lastSync + ' 以降の更新のみ）');
  }
  syncCandidacies();
}

/**
 * APIキーをダイアログで入力して保存
 */
function promptForApiKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'HERP APIキーの設定',
    'APIキーを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() === ui.Button.OK) {
    const apiKey = response.getResponseText().trim();
    if (apiKey) {
      PropertiesService.getScriptProperties().setProperty('HERP_API_TOKEN', apiKey);
      ui.alert('APIキーを保存しました');
    } else {
      ui.alert('APIキーが空です');
    }
  }
}

/**
 * 定期実行用のトリガーを設定
 * 毎日午前9時に実行
 */
function createDailyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncCandidacies') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // 新しいトリガーを作成
  ScriptApp.newTrigger('syncCandidacies')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  
  Logger.log('毎日午前9時に実行するトリガーを設定しました');
}

/**
 * トリガーを削除
 */
function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncCandidacies') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Logger.log('トリガーを削除しました');
}

/**
 * デバッグ用: 特定の応募者のコンタクト・評価情報を詳細に出力する
 * 藤井 輝生 (9c595e72-1bef-45f4-9f83-cf5ea9e31b91) のデバッグ用
 */
function debugCandidate() {
  const targetCandidacyId = '9c595e72-1bef-45f4-9f83-cf5ea9e31b91';
  
  Logger.log('=== デバッグ開始: 応募者ID ' + targetCandidacyId + ' ===');
  
  const apiKey = getApiKey();
  if (!apiKey) {
    Logger.log('エラー: APIキーが設定されていません');
    return;
  }
  
  // コンタクト一覧を取得
  Logger.log('コンタクト一覧を取得中...');
  const contacts = fetchContacts(apiKey, targetCandidacyId);
  Logger.log('コンタクト数: ' + contacts.length);
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    Logger.log('--- コンタクト ' + (i + 1) + ' ---');
    Logger.log('ID: ' + contact.id);
    Logger.log('step: ' + contact.step);
    
    // タイトルと日時の確認
    let title = '';
    let startsAt = '';
    if (contact.assessmentSchedule) {
      title = contact.assessmentSchedule.title || '(なし)';
      if (contact.assessmentSchedule.schedule) {
        startsAt = contact.assessmentSchedule.schedule.startsAt;
      }
    }
    Logger.log('title: ' + title);
    Logger.log('startsAt: ' + startsAt);
    
    // 評価キーの判定シミュレーション
    const evalKey = getEvaluationKey(contact.step, title);
    Logger.log('getEvaluationKey判定結果: ' + (evalKey || 'null'));
    
    // 評価情報の確認
    if (contact.evaluations && contact.evaluations.length > 0) {
      Logger.log('評価データあり (' + contact.evaluations.length + '件)');
      for (let j = 0; j < contact.evaluations.length; j++) {
        const evaluation = contact.evaluations[j];
        Logger.log('  評価 ' + (j + 1) + ': ID=' + evaluation.id + ', status=' + evaluation.status);
        
        if (evaluation.status === 'completed') {
          // 詳細を取得して回答を確認
          try {
            const detail = fetchEvaluationDetails(apiKey, evaluation.id);
            if (detail && detail.evaluationForm && detail.evaluationForm.items) {
              const firstItem = detail.evaluationForm.items[0];
              const answer = (firstItem && firstItem.answer && firstItem.answer.length > 0) ? firstItem.answer[0] : '(なし)';
              Logger.log('  回答(1問目): ' + answer);
            } else {
              Logger.log('  詳細情報の構造が予期しない形式です');
            }
          } catch (e) {
            Logger.log('  詳細取得エラー: ' + e.message);
          }
        }
      }
    } else {
      Logger.log('評価データなし');
    }
  }
  
  Logger.log('=== デバッグ終了 ===');
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = JSON.parse(e.postData.contents);

    // 新規追加: 【PdM】スカウト シートへの記録
    if (data.type === 'scout_sent') {
      let scoutSheet = ss.getSheetByName('【PdM】スカウト');
      if (!scoutSheet) {
        scoutSheet = ss.insertSheet('【PdM】スカウト');
        scoutSheet.appendRow(['URL', '媒体', 'ポジション', '送信者', '送信日時', '週']);
      }
      scoutSheet.appendRow([
        data.url,
        data.media || 'ビズリーチ',
        data.position || '',
        data.sender || 'ゆーや',
        data.date || '',
        data.week || ''
      ]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 従来の ビズリーチ送付履歴 への記録
    let historySheet = ss.getSheetByName('ビズリーチ送付履歴');
    if (!historySheet) {
      historySheet = ss.insertSheet('ビズリーチ送付履歴');
      historySheet.appendRow(['URL', '判定', 'スカウト判定', '得意領域', 'やりたいこと', 'クラス', 'ステータス', '求人タイトル', '本文', '判定日時', 'プロフィール']);
    }

    historySheet.appendRow([
      data.url,
      String(data.evaluation || ''),
      data.decision || '',
      data.strengths || '',
      data.aspirations || '',
      data.class || '',
      data.status || '',
      data.title || '',
      data.body || '',
      new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      data.profile || ''
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
