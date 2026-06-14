from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx

from .models import PricePoint, Quote, StockMaster

TWSE_BASE = "https://openapi.twse.com.tw/v1"
TWSE_STOCK_DAY_ALL = f"{TWSE_BASE}/exchangeReport/STOCK_DAY_ALL"
TWSE_LISTED_COMPANIES = f"{TWSE_BASE}/opendata/t187ap03_L"
TPEX_MAINBOARD_PERATIO = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"
TWSE_HISTORY = "https://www.twse.com.tw/exchangeReport/STOCK_DAY"

CACHE: dict[str, tuple[float, Any]] = {}

MANUAL_ETFS = [
    StockMaster(code="0050", name="元大台灣50", shortName="元大50", market="ETF", industry="ETF", aliases=["元大50", "台灣50", "0050"]),
    StockMaster(code="00631L", name="元大台灣50正2", shortName="元大50正二", market="ETF", industry="槓桿型ETF", aliases=["元大50正2", "元大50正二", "台灣50正2", "台灣50正二", "00631L"]),
    StockMaster(code="0056", name="元大高股息", shortName="高股息", market="ETF", industry="ETF", aliases=["0056", "高股息"]),
    StockMaster(code="00878", name="國泰永續高股息", shortName="國泰永續高股息", market="ETF", industry="ETF", aliases=["00878", "國泰高股息"]),
    StockMaster(code="00981A", name="熱門台股 ETF", shortName="00981A", market="ETF", industry="主動式ETF", aliases=["00981A", "熱門ETF", "台股ETF"]),
]

FALLBACK_STOCKS = MANUAL_ETFS + [
    StockMaster(code="2330", name="台積電", shortName="台積電", market="上市", industry="半導體", aliases=["TSMC", "台積"]),
    StockMaster(code="2317", name="鴻海", shortName="鴻海", market="上市", industry="電子代工", aliases=["Foxconn"]),
    StockMaster(code="2454", name="聯發科", shortName="聯發科", market="上市", industry="IC設計", aliases=["MediaTek"]),
    StockMaster(code="2303", name="聯電", shortName="聯電", market="上市", industry="半導體", aliases=["UMC"]),
    StockMaster(code="2308", name="台達電", shortName="台達電", market="上市", industry="電源管理", aliases=["台達"]),
    StockMaster(code="2882", name="國泰金", shortName="國泰金", market="上市", industry="金融保險", aliases=["國泰"]),
    StockMaster(code="2603", name="長榮", shortName="長榮", market="上市", industry="航運", aliases=["長榮海運"]),
]

FALLBACK_QUOTES: dict[str, dict[str, float]] = {
    "0050": {"price": 182.35, "previousClose": 181.1, "open": 181.4, "high": 183.1, "low": 180.95, "volume": 24180},
    "00631L": {"price": 241.6, "previousClose": 236.9, "open": 237.8, "high": 242.2, "low": 237.0, "volume": 32560},
    "0056": {"price": 37.18, "previousClose": 37.0, "open": 37.02, "high": 37.25, "low": 36.94, "volume": 40800},
    "00878": {"price": 22.78, "previousClose": 22.72, "open": 22.74, "high": 22.84, "low": 22.66, "volume": 68240},
    "00981A": {"price": 12.58, "previousClose": 12.12, "open": 12.18, "high": 12.62, "low": 12.15, "volume": 98600},
    "2330": {"price": 875, "previousClose": 863, "open": 866, "high": 878, "low": 861, "volume": 51230},
    "2317": {"price": 156.5, "previousClose": 158, "open": 158, "high": 159, "low": 155.5, "volume": 38900},
    "2454": {"price": 1245, "previousClose": 1220, "open": 1220, "high": 1255, "low": 1215, "volume": 16480},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_code(code: str) -> str:
    return str(code or "").strip().upper()


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace("+", "")
    if not text or text in {"--", "---", "-"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def value_of(row: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def is_etf_code(code: str, name: str = "") -> bool:
    return code.startswith("00") or any(token in name for token in ["ETF", "ETN", "指數股票型", "主動式"])


async def fetch_json(url: str, ttl: int = 300) -> Any:
    if os.getenv("USE_MOCK_DATA") == "true":
        raise RuntimeError("mock mode")
    cached = CACHE.get(url)
    if cached and cached[0] > time.time():
        return cached[1]
    async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": "taiwan-stock-ai-python-backend/1.0"}) as client:
        res = await client.get(url)
        res.raise_for_status()
        data = res.json()
    CACHE[url] = (time.time() + ttl, data)
    return data


def merge_stocks(groups: list[list[StockMaster]]) -> list[StockMaster]:
    merged: dict[str, StockMaster] = {}
    for group in groups:
        for stock in group:
            if not stock.code:
                continue
            current = merged.get(stock.code)
            if not current:
                merged[stock.code] = stock
                continue
            aliases = list(dict.fromkeys([*(current.aliases or []), *(stock.aliases or [])]))
            merged[stock.code] = StockMaster(
                code=stock.code,
                name=current.name if len(current.name) >= len(stock.name) else stock.name,
                shortName=current.shortName or stock.shortName,
                market=stock.market or current.market,
                industry=current.industry or stock.industry,
                aliases=aliases,
                issuedShares=current.issuedShares or stock.issuedShares,
            )
    return sorted(merged.values(), key=lambda item: item.code)


async def get_twse_listed_stocks() -> list[StockMaster]:
    rows = await fetch_json(TWSE_LISTED_COMPANIES, 24 * 60 * 60)
    mapped: list[StockMaster] = []
    for row in rows if isinstance(rows, list) else []:
        code = value_of(row, ["公司代號", "Code", "證券代號"])
        name = value_of(row, ["公司名稱", "Name", "證券名稱"])
        short_name = value_of(row, ["公司簡稱", "簡稱", "Name"])
        if not code or not name:
            continue
        alias = value_of(row, ["英文簡稱", "英文名稱", "English Name"])
        mapped.append(StockMaster(code=code, name=name, shortName=short_name or name, market="上市", industry=value_of(row, ["產業別", "Industry"]) or None, aliases=[alias] if alias else []))
    return mapped


async def get_twse_daily_master() -> list[StockMaster]:
    rows = await fetch_json(TWSE_STOCK_DAY_ALL, 60)
    mapped: list[StockMaster] = []
    for row in rows if isinstance(rows, list) else []:
        code = value_of(row, ["Code", "證券代號", "代號"])
        name = value_of(row, ["Name", "證券名稱", "名稱"])
        if not code or not name:
            continue
        market = "ETF" if is_etf_code(code, name) else "上市"
        mapped.append(StockMaster(code=code, name=name, shortName=name, market=market, industry="ETF" if market == "ETF" else None))
    return mapped


async def get_tpex_stocks() -> list[StockMaster]:
    try:
        rows = await fetch_json(TPEX_MAINBOARD_PERATIO, 24 * 60 * 60)
    except Exception:
        return []
    mapped: list[StockMaster] = []
    for row in rows if isinstance(rows, list) else []:
        code = value_of(row, ["SecuritiesCompanyCode", "SecurityCode", "Code", "股票代號", "證券代號", "代號"])
        name = value_of(row, ["CompanyName", "SecuritiesCompanyName", "SecurityName", "Name", "股票名稱", "證券名稱", "名稱"])
        if code and name:
            mapped.append(StockMaster(code=code, name=name, shortName=name, market="上櫃"))
    return mapped


async def get_stock_master() -> list[StockMaster]:
    key = "stock_master"
    cached = CACHE.get(key)
    if cached and cached[0] > time.time():
        return cached[1]
    try:
        groups = await asyncio.gather(get_twse_listed_stocks(), get_twse_daily_master(), get_tpex_stocks(), return_exceptions=True)
        valid_groups = [group for group in groups if isinstance(group, list)]
        data = merge_stocks([*valid_groups, MANUAL_ETFS]) or FALLBACK_STOCKS
    except Exception:
        data = FALLBACK_STOCKS
    CACHE[key] = (time.time() + 12 * 60 * 60, data)
    return data


def make_fallback_quote(stock: StockMaster) -> Quote:
    q = FALLBACK_QUOTES.get(stock.code, {"price": 100, "previousClose": 99, "open": 99, "high": 101, "low": 98, "volume": 1000})
    price = q.get("price")
    prev = q.get("previousClose")
    change = price - prev if price is not None and prev else None
    change_pct = (change / prev * 100) if change is not None and prev else None
    return Quote(code=stock.code, name=stock.shortName or stock.name, market=stock.market, industry=stock.industry, price=price, previousClose=prev, open=q.get("open"), high=q.get("high"), low=q.get("low"), change=change, changePct=change_pct, volume=q.get("volume"), turnover=(price or 0) * (q.get("volume") or 0) * 1000, marketCap=None, updatedAt=now_iso(), source="Python fallback-demo")


async def get_daily_quotes() -> list[Quote]:
    if os.getenv("USE_MOCK_DATA") == "true":
        return [make_fallback_quote(stock) for stock in FALLBACK_STOCKS]
    try:
        stocks, rows = await asyncio.gather(get_stock_master(), fetch_json(TWSE_STOCK_DAY_ALL, 60))
        by_code = {stock.code: stock for stock in stocks}
        quotes: list[Quote] = []
        for row in rows if isinstance(rows, list) else []:
            code = value_of(row, ["Code", "證券代號", "代號"])
            if not code:
                continue
            fallback_name = value_of(row, ["Name", "證券名稱", "名稱"]) or code
            stock = by_code.get(code) or StockMaster(code=code, name=fallback_name, shortName=fallback_name, market="ETF" if is_etf_code(code, fallback_name) else "上市")
            price = parse_number(row.get("ClosingPrice") or row.get("收盤價"))
            open_ = parse_number(row.get("OpeningPrice") or row.get("開盤價"))
            high = parse_number(row.get("HighestPrice") or row.get("最高價"))
            low = parse_number(row.get("LowestPrice") or row.get("最低價"))
            change = parse_number(row.get("Change") or row.get("漲跌價差"))
            previous_close = price - change if price is not None and change is not None else None
            change_pct = change / previous_close * 100 if change is not None and previous_close else None
            volume_raw = parse_number(row.get("TradeVolume") or row.get("成交股數"))
            turnover = parse_number(row.get("TradeValue") or row.get("成交金額"))
            quotes.append(Quote(code=code, name=stock.shortName or stock.name, market=stock.market, industry=stock.industry, price=price, previousClose=previous_close, open=open_, high=high, low=low, change=change, changePct=change_pct, volume=round(volume_raw / 1000) if volume_raw is not None else None, turnover=turnover, marketCap=(stock.issuedShares or 0) * price if stock.issuedShares and price else None, updatedAt=now_iso(), source="Python TWSE OpenAPI /exchangeReport/STOCK_DAY_ALL"))
        return quotes or [make_fallback_quote(stock) for stock in FALLBACK_STOCKS]
    except Exception:
        return [make_fallback_quote(stock) for stock in FALLBACK_STOCKS]


async def search_stocks(query: str, limit: int = 50) -> list[StockMaster]:
    q = (query or "").strip().lower().replace(" ", "")
    stocks = await get_stock_master()
    if not q:
        return stocks[: min(limit, 200)]
    result = []
    for stock in stocks:
        haystack = " ".join([stock.code, stock.name, stock.shortName or "", stock.market, stock.industry or "", *stock.aliases]).lower().replace(" ", "")
        if q in haystack:
            result.append(stock)
    return result[: min(limit, 200)]


async def get_quote(code: str) -> Quote | None:
    normalized = normalize_code(code)
    daily = await get_daily_quotes()
    for quote_item in daily:
        if quote_item.code == normalized:
            return quote_item
    stocks = await get_stock_master()
    stock = next((item for item in stocks if item.code == normalized), None)
    return make_fallback_quote(stock) if stock else None


def fallback_history(code: str, base_price: float = 100) -> list[PricePoint]:
    today = datetime.now(timezone.utc).date()
    points = []
    for i in range(95, -1, -1):
        day = today - timedelta(days=i)
        wave = math.sin(i * 0.24 + len(code)) * base_price * 0.05
        drift = (95 - i) * base_price * 0.0006
        close = max(base_price + wave + drift, 1)
        points.append(PricePoint(date=day.isoformat(), open=close * 0.995, high=close * 1.012, low=close * 0.988, close=close, volume=round(1000 + abs(math.sin(i)) * 8000)))
    return points


def yahoo_range(range_key: str) -> str:
    return {"1w": "1mo", "1m": "2mo", "1y": "1y"}.get(range_key, "6mo")


async def get_history(code: str, range_key: str = "1m") -> list[PricePoint]:
    normalized = normalize_code(code)
    try:
        symbol = f"{quote(normalized)}.TW"
        url = f"https://query1.finance.yahoo.com/v9/finance/chart/{symbol}?range={yahoo_range(range_key)}&interval=1d"
        data = await fetch_json(url, 60 * 60)
        result = (data.get("chart", {}).get("result") or [None])[0]
        timestamps = result.get("timestamp") or []
        quote_data = (result.get("indicators", {}).get("quote") or [{}])[0]
        points: list[PricePoint] = []
        for idx, ts in enumerate(timestamps):
            close = (quote_data.get("close") or [None])[idx]
            if close is None:
                continue
            points.append(PricePoint(date=datetime.fromtimestamp(ts, timezone.utc).date().isoformat(), open=(quote_data.get("open") or [None])[idx], high=(quote_data.get("high") or [None])[idx], low=(quote_data.get("low") or [None])[idx], close=close, volume=(quote_data.get("volume") or [None])[idx]))
        days = {"1w": 7, "1m": 31, "3m": 93, "1y": 366}.get(range_key, 31)
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
        filtered = [point for point in points if point.date >= cutoff]
        return filtered or points[-days:]
    except Exception:
        quote_item = await get_quote(normalized)
        return fallback_history(normalized, quote_item.price if quote_item and quote_item.price else 100)
