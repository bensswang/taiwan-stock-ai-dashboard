# V24 - OpenAI API Key Guard

本版重點是讓網站「確定有用 OpenAI 才顯示 AI 摘要」。

## 修改內容

1. 新增 `/api/ai/status`
   - 回傳目前是否已設定 `OPENAI_API_KEY`。
   - 前端會顯示 `AI 模式：OpenAI / 模型` 或 `AI 模式：未設定 API Key`。

2. 移除「默默 fallback 成本地模板」行為
   - 個股新聞摘要 `/api/ai/analyze` 若沒有 key，會回傳 503。
   - 自選股當日重點 `/api/ai/watchlist` 若沒有 key，會回傳 503。
   - OpenAI 呼叫失敗時，會顯示錯誤，不再用 local-rules 假裝是 AI 摘要。

3. 前端狀態更清楚
   - Header 會顯示 AI 模式。
   - 個股摘要按鈕在沒有 API Key 時會停用並顯示「尚未設定 API Key」。
   - 自選股摘要區會提示需要設定 `OPENAI_API_KEY`。

4. 保留上一版
   - 可信新聞來源篩選。
   - 近五天新聞摘要格式。
   - 自選股當日重點格式。
   - 立即更新按鈕轉圈圈。

## Netlify 必要設定

請在 Netlify Site settings / Project configuration 的 Environment variables 新增：

```text
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` 可不填；預設會使用 `gpt-4.1-mini`。
