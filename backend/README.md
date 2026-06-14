# Python FastAPI 後端

這個資料夾是本專案的 Python 核心後端。前端保留原本的 Next.js 視覺介面，但股票資料、新聞整理與 Groq AI 摘要可以改由這裡處理。

## 本機啟動

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # macOS / Linux
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

開啟：

```txt
http://localhost:8000/health
```

## 前端如何連到 Python

在 Netlify 的環境變數新增：

```txt
PYTHON_API_URL=https://你的-python-backend網址
```

前端仍然呼叫 `/api/stocks/quote`、`/api/news`、`/api/ai/analyze`，Next.js API route 會自動把請求轉送到 Python FastAPI 後端。

如果沒有設定 `PYTHON_API_URL`，網站會退回原本的 TypeScript API 邏輯，方便測試與備援。

## 主要 API

```txt
GET  /api/stocks/search?q=台積電
GET  /api/stocks/quote
GET  /api/stocks/quote?code=2330
GET  /api/stocks/quote?codes=2330,0050,00631L
GET  /api/stocks/history?code=2330&range=1m
GET  /api/news?code=2330&company=台積電&days=5
GET  /api/ai/status
POST /api/ai/analyze
POST /api/ai/watchlist
```

## 課程說明可用文字

本專案以 Python FastAPI 作為核心資料處理與 AI 分析後端，負責股票資料取得、新聞資料整理、可信來源篩選、自選股 12 小時摘要快取與 Groq AI 摘要。前端網頁主要負責互動介面與視覺化呈現，因此系統核心邏輯以 Python 為主。
