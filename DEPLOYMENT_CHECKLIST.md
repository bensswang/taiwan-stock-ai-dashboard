# 部署檢查表

## 上線前

- [ ] 執行 `npm install`
- [ ] 執行 `npm run build`
- [ ] 確認首頁可正常打開
- [ ] 確認 `/api/stocks/search?q=2330` 可回傳資料
- [ ] 確認 `/api/stocks/quote?code=2330` 可回傳資料
- [ ] 確認 `/api/stocks/history?code=2330&range=1m` 可回傳資料
- [ ] 確認 `/api/news?code=2330&company=台積電` 可回傳新聞
- [ ] 如需 AI 模型，設定 `OPENAI_API_KEY`

## 法務與授權

- [ ] 確認行情資料來源授權
- [ ] 確認新聞來源使用方式
- [ ] 在網站加入免責聲明：資訊僅供參考，不構成投資建議

## 後續升級

- [ ] 加入 TPEx 上櫃資料
- [ ] 加入資料庫
- [ ] 加入會員登入
- [ ] 加入合法即時行情資料
