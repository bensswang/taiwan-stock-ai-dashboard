from __future__ import annotations

from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .ai_service import ai_status, analyze_stock_news, build_watchlist_digest
from .models import AnalyzeRequest, WatchlistRequest
from .news_service import get_news_by_stock
from .stock_service import get_daily_quotes, get_history, get_quote, get_quotes_with_realtime_fallback, get_realtime_quote, search_stocks

load_dotenv()

app = FastAPI(
    title="Taiwan Stock AI Python Backend",
    description="以 Python FastAPI 實作股票資料、可信新聞與 Groq AI 摘要核心後端。",
    version="28.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"ok": "true", "backend": "python-fastapi"}


@app.get("/api/ai/status")
async def api_ai_status() -> dict[str, Any]:
    return ai_status()


@app.get("/api/stocks/search")
async def api_stock_search(q: str = "", limit: int = 50) -> dict[str, Any]:
    data = await search_stocks(q, limit)
    return {"query": q, "count": len(data), "data": [item.model_dump() for item in data]}


@app.get("/api/stocks/quote")
async def api_stock_quote(code: str | None = None, codes: str | None = None, realtime: str = "1") -> dict[str, Any]:
    use_realtime = realtime != "0"
    if codes:
        wanted = [item.strip().upper() for item in codes.split(",") if item.strip()]
        quotes = await get_quotes_with_realtime_fallback(wanted) if use_realtime else [item for item in await get_daily_quotes() if item.code in wanted]
        return {"realtime": use_realtime, "count": len(quotes), "data": [item.model_dump() for item in quotes]}
    if code:
        quote = await get_realtime_quote(code) if use_realtime else None
        quote = quote or await get_quote(code)
        if not quote:
            raise HTTPException(status_code=404, detail=f"找不到股票代號 {code}")
        return {"realtime": use_realtime and "MIS" in quote.source, "data": quote.model_dump()}
    quotes = await get_daily_quotes()
    return {"realtime": False, "count": len(quotes), "data": [item.model_dump() for item in quotes]}


@app.get("/api/stocks/history")
async def api_stock_history(code: str = Query(...), range: str = "1m") -> dict[str, Any]:
    data = await get_history(code, range)
    return {"code": code.strip().upper(), "range": range, "count": len(data), "data": [item.model_dump() for item in data]}


@app.get("/api/news")
async def api_news(code: str | None = None, company: str | None = None, days: int = 5) -> dict[str, Any]:
    if not code and not company:
        raise HTTPException(status_code=400, detail="請提供 code 或 company")
    safe_days = max(1, min(days, 30))
    final_code, final_company, news = await get_news_by_stock(code or "TW", company, safe_days)
    return {"code": final_code, "company": final_company, "days": safe_days, "count": len(news), "data": [item.model_dump() for item in news]}


@app.post("/api/ai/analyze")
async def api_ai_analyze(payload: AnalyzeRequest) -> dict[str, Any]:
    try:
        data = await analyze_stock_news(payload.stock, payload.news)
    except RuntimeError as exc:
        if str(exc) == "GROQ_API_KEY_MISSING":
            raise HTTPException(status_code=503, detail="尚未設定 GROQ_API_KEY")
        raise
    return {"data": data}


@app.post("/api/ai/watchlist")
async def api_ai_watchlist(payload: WatchlistRequest) -> dict[str, Any]:
    try:
        data = await build_watchlist_digest(payload.watchlist, payload.quotes, payload.force)
    except RuntimeError as exc:
        if str(exc) == "GROQ_API_KEY_MISSING":
            raise HTTPException(status_code=503, detail="尚未設定 GROQ_API_KEY")
        raise
    return {"data": data}
