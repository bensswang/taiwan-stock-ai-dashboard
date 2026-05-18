# V25 - Groq API 版

本版將 AI 摘要供應商從 OpenAI 改為 Groq。

## 修改重點

1. AI 狀態檢查改讀 `GROQ_API_KEY`。
2. 個股新聞摘要 `/api/ai/analyze` 改呼叫 Groq OpenAI-compatible Chat Completions。
3. 自選股當日重點 `/api/ai/watchlist` 改呼叫 Groq。
4. 前端顯示改成 `AI 模式：Groq / 模型`。
5. 未設定 API Key 時，錯誤提示改為 `GROQ_API_KEY`。

## Netlify 環境變數

請在 Netlify → Site configuration → Environment variables 新增：

```txt
GROQ_API_KEY=你的 Groq API Key
```

選填：

```txt
GROQ_MODEL=llama-3.3-70b-versatile
```

設定後請重新 Deploy。
