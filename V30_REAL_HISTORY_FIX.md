# V30 真實歷史走勢修正

## 修正原因

V29 Python 後端在歷史價格來源失敗時，會使用波浪狀示範資料，造成圖表看起來像假走勢。這在股票網站中容易誤導使用者。

## 修正內容

- 移除 Python 後端的波浪狀 fallback 歷史資料。
- `backend/app/stock_service.py` 改成優先讀取 TWSE 官方 `STOCK_DAY` 月資料。
- Yahoo Finance chart API 僅作為補強來源。
- 若外部資料暫時抓不到，寧可回傳空資料，不再畫出假走勢。
- 新增尾端異常值過濾，避免資料來源錯值讓圖表突然暴跌或暴漲。

## 影響

`/api/stocks/history?code=0050&range=1m` 等歷史走勢會改以真實資料為主，不再顯示正弦波狀示範曲線。
