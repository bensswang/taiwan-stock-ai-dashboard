from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .news_service import get_news_by_stock
from .stock_service import get_history, get_stock_master

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
WATCHLIST_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_TTL_SECONDS = 12 * 60 * 60


def groq_model() -> str:
    return os.getenv("GROQ_MODEL") or "llama-3.3-70b-versatile"


def ai_status() -> dict[str, Any]:
    configured = bool(os.getenv("GROQ_API_KEY"))
    return {"configured": configured, "mode": "groq" if configured else "missing-key", "model": groq_model() if configured else None, "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


def clean_visible_text(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    banned = ["不提供買賣建議", "這一段是", "不要逐條搬標題"]
    for phrase in banned:
        text = text.replace(phrase, "")
    return text.strip()


async def call_groq(messages: list[dict[str, str]], temperature: float = 0.25, max_tokens: int = 900) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY_MISSING")
    async with httpx.AsyncClient(timeout=45) as client:
        res = await client.post(GROQ_ENDPOINT, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json={"model": groq_model(), "messages": messages, "temperature": temperature, "max_tokens": max_tokens})
        res.raise_for_status()
        data = res.json()
    return clean_visible_text(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def date_label(value: str | None) -> str:
    if not value:
        return "日期未明"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone(timezone(timedelta(hours=8))).strftime("%m/%d")
    except Exception:
        return "日期未明"


def fallback_analysis(stock: dict[str, Any] | None, news: list[dict[str, Any]]) -> dict[str, Any]:
    stock_name = stock.get("name") if isinstance(stock, dict) else "個股"
    titles = [item.get("title", "") for item in news[:4] if isinstance(item, dict)]
    summary = f"{stock_name} 近五天主要新聞集中在{titles[0] if titles else '公司與產業消息'}。目前資料量有限，建議搭配股價、成交量與公司公告確認事件影響。"
    return {"tone": "中性", "summary": summary, "keyPoints": titles[:3], "risks": ["新聞來源與行情資料可能延遲", "AI 摘要僅供資訊整理"], "sourceCount": len(news), "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "provider": "groq"}


async def analyze_stock_news(stock: dict[str, Any] | None, news: list[dict[str, Any]]) -> dict[str, Any]:
    if not os.getenv("GROQ_API_KEY"):
        raise RuntimeError("GROQ_API_KEY_MISSING")
    stock_name = stock.get("name") if isinstance(stock, dict) else "個股"
    stock_code = stock.get("code") if isinstance(stock, dict) else ""
    price_line = ""
    if isinstance(stock, dict):
        price_line = f"價格：{stock.get('price')}；漲跌幅：{stock.get('changePct')}%；成交量：{stock.get('volume')}"
    news_lines = "\n".join([f"{idx+1}. {date_label(item.get('publishedAt'))}｜{item.get('source','')}｜{item.get('title','')}｜{item.get('excerpt','')}" for idx, item in enumerate(news[:10])])
    prompt = f"""
請用繁體中文整理台股個股新聞，不要提供買賣建議。
股票：{stock_name} {stock_code}
{price_line}
新聞：
{news_lines or '資料不足'}

請輸出：
1. 一段 120-180 字新聞摘要
2. 3 個整理重點
3. 2 個風險提醒
4. 語氣只能是：偏多、中性偏多、中性、中性偏空、偏空
""".strip()
    content = await call_groq([{"role": "system", "content": "你是台股新聞與量價資料整理助手。"}, {"role": "user", "content": prompt}], max_tokens=900)
    lines = [line.strip(" -•0123456789.、") for line in content.splitlines() if line.strip()]
    key_points = [line for line in lines if len(line) > 8][:3]
    tone = "中性"
    for candidate in ["中性偏多", "中性偏空", "偏多", "偏空", "中性"]:
        if candidate in content:
            tone = candidate
            break
    return {"tone": tone, "summary": content, "keyPoints": key_points, "risks": ["新聞與行情資料可能有延遲", "事件影響仍需搭配公司公告與後續量價確認"], "sourceCount": len(news), "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "provider": "groq"}


def taiwan_date() -> str:
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def extract_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    # 移除模型可能加上的 Markdown code fence。
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I).strip()
    raw = re.sub(r"\s*```$", "", raw).strip()
    candidates = [raw]
    if "{" in raw and "}" in raw:
        candidates.append(raw[raw.find("{"): raw.rfind("}") + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            continue
    return None


def normalize_watchlist_digest(raw: str, source_count: int, chart_count: int, now: float) -> dict[str, Any]:
    parsed = extract_json_object(raw)
    if parsed:
        headline = clean_visible_text(str(parsed.get("headline") or "自選股當日重點已整理完成。"))
        paragraphs_raw = parsed.get("paragraphs")
        if isinstance(paragraphs_raw, list):
            paragraphs = [clean_visible_text(str(item)) for item in paragraphs_raw if clean_visible_text(str(item))]
        else:
            paragraphs = [clean_visible_text(str(paragraphs_raw))] if paragraphs_raw else []
        outlook = clean_visible_text(str(parsed.get("outlook") or "後續觀察量價是否延續，以及是否有公司公告或法人籌碼變化。"))
    else:
        # 如果模型沒有乖乖輸出 JSON，就退回純文字分段，但不把 JSON 原文直接當標題。
        lines = [clean_visible_text(line) for line in raw.splitlines() if clean_visible_text(line)]
        # 避免把看起來像 JSON 的整段字串顯示出去。
        lines = [line for line in lines if not (line.startswith("{") or line.startswith('"headline"') or "\"paragraphs\"" in line)]
        headline = lines[0][:80] if lines else "自選股當日重點已整理完成。"
        paragraphs = lines[1:4] if len(lines) > 1 else ["今日自選股主要觀察量價變化、新聞事件與族群輪動，請搭配個股新聞與圖表確認。"]
        outlook = lines[-1] if lines else "後續觀察量價是否延續，以及是否有公司公告或法人籌碼變化。"

    if not paragraphs:
        paragraphs = ["今日自選股主要觀察量價變化、新聞事件與族群輪動，請搭配個股新聞與圖表確認。"]
    return {
        "headline": headline,
        "paragraphs": paragraphs[:4],
        "outlook": outlook,
        "sourceCount": source_count,
        "chartCount": chart_count,
        "targetDate": taiwan_date(),
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nextUpdateAt": datetime.fromtimestamp(now + CACHE_TTL_SECONDS, timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider": "groq",
    }


async def build_watchlist_digest(watchlist: list[str], quotes: list[dict[str, Any]], force: bool = False) -> dict[str, Any]:
    codes = [str(code).strip().upper() for code in watchlist if str(code).strip()][:12]
    key = ",".join(codes)
    now = time.time()
    if not force and key in WATCHLIST_CACHE and WATCHLIST_CACHE[key][0] > now:
        return WATCHLIST_CACHE[key][1]
    if not os.getenv("GROQ_API_KEY"):
        raise RuntimeError("GROQ_API_KEY_MISSING")

    stocks = await get_stock_master()
    by_code = {stock.code: stock for stock in stocks}
    quote_by_code = {str(q.get("code", "")).upper(): q for q in quotes if isinstance(q, dict)}
    all_news: list[dict[str, Any]] = []
    chart_signals: list[str] = []
    for code in codes[:8]:
        stock = by_code.get(code)
        company = stock.shortName or stock.name if stock else code
        _, _, news = await get_news_by_stock(code, company, 5)
        all_news.extend([item.model_dump() for item in news[:3]])
        history = await get_history(code, "1m")
        latest = history[-1] if history else None
        q = quote_by_code.get(code) or {}
        chart_signals.append(f"{code} {company}：漲跌幅 {q.get('changePct')}%，最新收盤 {getattr(latest, 'close', None)}，成交量 {q.get('volume')}。")

    news_text = "\n".join([f"{item.get('code')} {item.get('company')}｜{item.get('source')}｜{item.get('title')}" for item in all_news[:18]])
    chart_text = "\n".join(chart_signals)
    prompt = f"""
請根據自選股新聞與量價訊號，整理今日台股自選股重點。
日期：{taiwan_date()}
自選股：{', '.join(codes)}

新聞：
{news_text or '資料不足'}

量價：
{chart_text or '資料不足'}

請用 JSON 格式回覆，欄位必須包含：headline, paragraphs, outlook。
headline 一句話，paragraphs 為三個段落陣列，outlook 是後續留意。
""".strip()
    raw = await call_groq([{"role": "system", "content": "你是台股自選股新聞整理助手。請只輸出合法 JSON，不要加 Markdown code fence，也不要在 JSON 外加說明文字。"}, {"role": "user", "content": prompt}], max_tokens=1000)
    data = normalize_watchlist_digest(raw, len(all_news), len(chart_signals), now)
    WATCHLIST_CACHE[key] = (now + CACHE_TTL_SECONDS, data)
    return data
