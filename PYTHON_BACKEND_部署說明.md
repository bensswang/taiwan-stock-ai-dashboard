# Python FastAPI 後端部署說明

這版的目標是讓專案符合「以 Python 為主」的課程要求：

```txt
前端：保留原本漂亮的 Next.js / React 畫面
後端：新增 Python FastAPI，負責股票資料、新聞整理、AI 摘要
```

## 一、架構

```txt
瀏覽器
→ Netlify 前端 /api/...
→ 若有設定 PYTHON_API_URL，轉送到 Python FastAPI
→ Python 負責資料處理與 Groq AI
→ 回傳 JSON 給前端畫面
```

如果沒有設定 `PYTHON_API_URL`，網站會退回原本的 TypeScript API，方便本機測試與備援。

## 二、Python 後端位置

```txt
backend/
  app/
    main.py
    stock_service.py
    news_service.py
    ai_service.py
    models.py
  requirements.txt
  render.yaml
  .env.example
```

主要 Python 功能：

```txt
1. 股票搜尋與行情資料整理
2. 個股歷史價格資料
3. Google News RSS 新聞抓取
4. 可信來源篩選與新聞分類
5. Groq AI 個股新聞摘要
6. 自選股 12 小時新聞與重點整理快取
```

## 三、本機測試 Python 後端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

測試：

```txt
http://localhost:8000/health
```

## 四、本機讓前端連 Python

前端根目錄 `.env.local` 加入：

```txt
PYTHON_API_URL=http://localhost:8000
GROQ_API_KEY=你的 Groq Key
GROQ_MODEL=llama-3.3-70b-versatile
```

再啟動前端：

```bash
npm run dev
```

## 五、部署建議

### 前端

繼續放 Netlify。

### Python 後端

建議放 Render。

Render 設定：

```txt
Root Directory: 留空或專案根目錄
Build Command: pip install -r backend/requirements.txt
Start Command: cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Render Environment Variables：

```txt
GROQ_API_KEY=你的 Groq API Key
GROQ_MODEL=llama-3.3-70b-versatile
```

Netlify Environment Variables：

```txt
PYTHON_API_URL=https://你的-render-python-backend網址
NEXT_PUBLIC_PYTHON_API_URL=https://你的-render-python-backend網址
GROQ_API_KEY=你的 Groq API Key
GROQ_MODEL=llama-3.3-70b-versatile
```

其中 `PYTHON_API_URL` 是關鍵。設定後，前端的股票、新聞、AI 摘要請求會優先轉送到 Python。

## 六、報告可以這樣寫

本專案是一個以 Python 為核心的台股資訊系統。系統使用 Python FastAPI 作為後端，負責股票資料取得、新聞資料整理、可信來源篩選、自選股 12 小時摘要快取與 Groq AI 摘要產生。前端網頁使用 Next.js / React 呈現互動介面、圖表與新聞卡片。因此，本系統的主要資料處理與分析邏輯以 Python 撰寫，前端僅作為視覺化展示層。


## V29 補充：如果 Netlify `/api` 空白

請另外設定：

```txt
NEXT_PUBLIC_PYTHON_API_URL=https://你的-render網址.onrender.com
```

這樣前端會直接呼叫 Python 後端，不再依賴 Netlify 的 `/api` route 轉送。
