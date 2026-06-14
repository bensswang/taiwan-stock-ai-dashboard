# V28 Python FastAPI 後端版

## 目的

依照課程要求「請以 Python 為主」，新增 Python FastAPI 後端，讓本專案不只是前端網站，而是以 Python 負責核心資料處理與 AI 分析的資訊系統。

## 新增內容

```txt
backend/app/main.py          FastAPI 入口
backend/app/stock_service.py 股票資料與歷史價格
backend/app/news_service.py  可信新聞抓取與分類
backend/app/ai_service.py    Groq AI 摘要與自選股 12 小時快取
backend/app/models.py        Pydantic 資料模型
backend/requirements.txt     Python 套件
backend/render.yaml          Render 部署範例
```

## 前端修改

新增：

```txt
lib/pythonProxy.ts
```

以下 Next.js API route 會在設定 `PYTHON_API_URL` 後優先轉送到 Python：

```txt
/api/stocks/search
/api/stocks/quote
/api/stocks/history
/api/news
/api/ai/status
/api/ai/analyze
/api/ai/watchlist
```

如果 Python 後端沒有設定或暫時失敗，會退回原本 TypeScript API 邏輯。

## 使用方式

Netlify 新增：

```txt
PYTHON_API_URL=https://你的-python-backend網址
```

Python 後端新增：

```txt
GROQ_API_KEY=你的 Groq API Key
GROQ_MODEL=llama-3.3-70b-versatile
```
