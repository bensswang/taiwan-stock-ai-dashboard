from __future__ import annotations

from typing import Literal, Optional, Any
from pydantic import BaseModel, Field

Market = Literal["上市", "上櫃", "ETF", "未知"]


class StockMaster(BaseModel):
    code: str
    name: str
    shortName: Optional[str] = None
    market: Market = "未知"
    industry: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    issuedShares: Optional[float] = None


class Quote(BaseModel):
    code: str
    name: str
    market: Market = "未知"
    industry: Optional[str] = None
    price: Optional[float] = None
    previousClose: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    change: Optional[float] = None
    changePct: Optional[float] = None
    volume: Optional[float] = None
    turnover: Optional[float] = None
    marketCap: Optional[float] = None
    updatedAt: str
    source: str
    note: Optional[str] = None


class PricePoint(BaseModel):
    date: str
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = None


class NewsItem(BaseModel):
    id: str
    code: str
    company: str
    title: str
    source: str
    publishedAt: str
    url: str
    excerpt: Optional[str] = None
    category: Optional[str] = None
    sourceTier: Optional[Literal["最高", "高", "中高"]] = None
    sourceLabel: Optional[str] = None
    sourceUrl: Optional[str] = None


class AnalyzeRequest(BaseModel):
    stock: Optional[dict[str, Any]] = None
    news: list[dict[str, Any]] = Field(default_factory=list)


class WatchlistRequest(BaseModel):
    watchlist: list[str] = Field(default_factory=list)
    quotes: list[dict[str, Any]] = Field(default_factory=list)
    force: bool = False
