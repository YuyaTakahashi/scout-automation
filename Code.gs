function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('ビズリーチ送付履歴');
    
    if (!sheet) {
      sheet = ss.insertSheet('ビズリーチ送付履歴');
      sheet.appendRow(['URL', '判定', 'スカウト判定', 'クラス', 'ステータス', '求人タイトル', '本文', '判定日時']);
    }

    const data = JSON.parse(e.postData.contents);
    
    sheet.appendRow([
      data.url,
      String(data.evaluation || ''),
      data.decision || '',
      data.class || '',
      data.status || '',
      data.title || '',
      data.body || '',
      new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
