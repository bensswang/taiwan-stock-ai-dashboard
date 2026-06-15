# V33 AI 摘要 JSON 顯示修正

## 問題

Groq 有時會依照 prompt 回傳 JSON 物件字串，例如：

```json
{"headline":"...","paragraphs":["..."],"outlook":"..."}
```

V32 後端沒有把這段 JSON 解析成物件，而是直接把原始 JSON 字串當成 headline / paragraph 顯示，造成畫面出現一大串 `{ "headline": ... }`。

## 修正

- Python 後端新增 `extract_json_object()`，會解析 Groq 回傳的 JSON。
- 支援移除 ```json code fence。
- 若模型沒有輸出合法 JSON，會退回乾淨的純文字分段，不再把 JSON 原文直接顯示在畫面。
- 前端自選股摘要快取 key 更新為 `tw-stock-watchlist-digest-cache-v3`，避免瀏覽器繼續讀到舊的壞快取。

## 部署後

重新部署 Render 與 Netlify 後，自選股 AI 摘要會恢復成：

```txt
標題一句話
段落一
段落二
段落三
後續留意
```

而不是 JSON 原文。
