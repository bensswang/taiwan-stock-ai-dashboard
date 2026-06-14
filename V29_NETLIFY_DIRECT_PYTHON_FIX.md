# V29 Netlify 直接連 Python 修正版

## 為什麼要改

有些 Netlify 部署情況下，Next.js `/api/...` route 可能沒有正常回應，導致網站出現 `Failed to fetch` 或 `/api/ai/status` 空白。

V29 加入前端直接呼叫 Python FastAPI 的方式。只要在 Netlify 設定：

```txt
NEXT_PUBLIC_PYTHON_API_URL=https://你的-render網址.onrender.com
```

前端就會直接把以下請求送到 Python：

```txt
/api/stocks/search
/api/stocks/quote
/api/stocks/history
/api/news
/api/ai/status
/api/ai/analyze
/api/ai/watchlist
```

## 環境變數設定

Render：

```txt
GROQ_API_KEY=你的 Groq API Key
GROQ_MODEL=llama-3.3-70b-versatile
PYTHON_VERSION=3.11.9
```

Netlify：

```txt
NEXT_PUBLIC_PYTHON_API_URL=https://你的-render網址.onrender.com
PYTHON_API_URL=https://你的-render網址.onrender.com
```

其中 `NEXT_PUBLIC_PYTHON_API_URL` 是這版最重要的修正。

## 注意

`NEXT_PUBLIC_PYTHON_API_URL` 會出現在瀏覽器端，但它只是一個後端網址，不是 API Key。Groq API Key 仍然只放在 Render 的 Python 後端，不會出現在前端。
