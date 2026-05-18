# Groq + Netlify 設定說明

這版已經把原本的 OpenAI API 改成 Groq API。

## 需要在 Netlify 設定

進入：

```txt
Netlify → Sites → 選你的網站 → Site configuration → Environment variables → Add a variable
```

新增：

```txt
GROQ_API_KEY=你的 Groq API Key
```

如果 Netlify 有 Scope 選項，請確認包含 Functions。

選填：

```txt
GROQ_MODEL=llama-3.3-70b-versatile
```

設定完成後請重新部署：

```txt
Deploys → Trigger deploy → Deploy site
```

## 這版修改到的主要檔案

```txt
app/api/ai/status/route.ts
app/api/ai/analyze/route.ts
app/api/ai/watchlist/route.ts
app/page.tsx
lib/types.ts
.env.example
README.md
V25_GROQ_CHANGELOG.md
```

## 部署後檢查

網站上方應顯示：

```txt
AI 模式：Groq / llama-3.3-70b-versatile
```

如果顯示未設定 API Key，通常代表：

1. Netlify 還沒設定 `GROQ_API_KEY`
2. 設定完沒有重新 Deploy
3. Key 貼錯或已失效
