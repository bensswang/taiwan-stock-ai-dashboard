from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx

from .models import NewsItem
from .stock_service import search_stocks

TRUSTED_SOURCES: dict[str, tuple[str, str]] = {
    "中央社": ("最高", "中央社"),
    "Reuters": ("最高", "Reuters"),
    "Bloomberg": ("最高", "Bloomberg"),
    "經濟日報": ("高", "經濟日報"),
    "工商時報": ("高", "工商時報"),
    "MoneyDJ": ("高", "MoneyDJ"),
    "鉅亨": ("中高", "鉅亨網"),
    "Yahoo股市": ("中高", "Yahoo股市"),
    "Yahoo奇摩股市": ("中高", "Yahoo股市"),
    "公開資訊觀測站": ("最高", "公開資訊觀測站"),
    "證交所": ("最高", "證交所"),
    "櫃買中心": ("最高", "櫃買中心"),
}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value: str | None) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_recent(iso: str, days: int) -> bool:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return True
    return dt >= datetime.now(timezone.utc) - timedelta(days=days)


def trust_of(source: str, title: str) -> tuple[str, str] | None:
    text = f"{source} {title}"
    for key, value in TRUSTED_SOURCES.items():
        if key.lower() in text.lower():
            return value
    return None


def infer_category(text: str) -> str:
    rules = [
        (r"營收|財報|EPS|獲利|毛利|財測|法說", "營收財報"),
        (r"訂單|客戶|蘋果|Apple|NVIDIA|輝達|英特爾|Intel|三星", "訂單客戶"),
        (r"AI|人工智慧|晶片|半導體|CoWoS|先進封裝|伺服器", "產品技術"),
        (r"外資|投信|自營商|法人|買超|賣超|目標價|評等", "法人籌碼"),
        (r"股利|配息|除息|除權|殖利率", "股利除權息"),
        (r"股價|漲停|跌停|大漲|大跌|成交量", "股價市場"),
        (r"政策|關稅|出口管制|補助|地緣|制裁", "產業政策"),
    ]
    for pattern, label in rules:
        if re.search(pattern, text, re.I):
            return label
    return "新聞事件"


def make_id(code: str, title: str, source: str) -> str:
    digest = hashlib.sha1(f"{code}|{source}|{title}".encode("utf-8")).hexdigest()[:14]
    return f"{code}-{digest}"


async def get_news_by_stock(code: str, company: str | None, days: int = 5) -> tuple[str, str, list[NewsItem]]:
    final_code = code.strip().upper() if code else "TW"
    final_company = company or final_code
    if code:
        matched = await search_stocks(final_code, 1)
        if matched:
            stock = matched[0]
            final_company = stock.shortName or stock.name or final_company
    trusted_query = " OR ".join(TRUSTED_SOURCES.keys())
    query = f"{final_company} {final_code} 股票 ({trusted_query}) when:{days}d"
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    items: list[NewsItem] = []
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": "taiwan-stock-ai-python-backend/1.0"}) as client:
            res = await client.get(url)
            res.raise_for_status()
        root = ET.fromstring(res.text)
        for node in root.findall(".//item"):
            raw_title = clean_text(node.findtext("title"))
            source_node = node.find("source")
            source = clean_text(source_node.text if source_node is not None else "Google News")
            trust = trust_of(source, raw_title) or trust_of(raw_title, raw_title)
            if not trust:
                continue
            published_at = parse_date(node.findtext("pubDate"))
            if not is_recent(published_at, days):
                continue
            link = clean_text(node.findtext("link")) or f"https://news.google.com/search?q={quote_plus(final_company)}"
            description = clean_text(node.findtext("description"))
            category = infer_category(f"{raw_title} {description} {source}")
            title = re.sub(r"\s[-－—]\s.*$", "", raw_title).strip() or raw_title
            items.append(NewsItem(id=make_id(final_code, title, source), code=final_code, company=final_company, title=title, source=source, publishedAt=published_at, url=link, excerpt=f"{source}｜{trust[0]}可信來源｜{category}" if not description else description[:160], category=category, sourceTier=trust[0], sourceLabel=trust[1]))
    except Exception:
        items = []
    seen: set[str] = set()
    deduped: list[NewsItem] = []
    for item in sorted(items, key=lambda x: x.publishedAt, reverse=True):
        key = re.sub(r"[\s，,。！!？?：:「」『』《》]", "", item.title)[:30]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return final_code, final_company, deduped[:12]
