# 迷你股票分析項目復刻指南 (Mini-Project Blueprint)

如果你想從零開始復刻一個「迷你版」系統，建議按照以下簡化路徑進行：

## 核心技術棧 (Minimal Stack)
- **語言**: Python 3.10+
- **數據**: `yfinance` (最簡單且免費)
- **AI**: `LiteLLM` (一個庫對接所有模型，包括免費的 Gemini)
- **界面**: `FastAPI` (後端) + `React` (前端)

---

## 第一步：核心分析邏輯 (Python)
不要試圖一次寫完所有功能。先做一個腳本 `analyze.py`：
1. **獲取數據**: 用 `yfinance` 下載 `AAPL` 最近 20 天的數據。
2. **計算均線**: 用 `pandas` 的 `df['MA5'] = df['Close'].rolling(window=5).mean()`。
3. **調用 AI**:
   ```python
   import litellm
   
   # 把數據變成 Markdown 表格
   data_str = df.tail(5).to_markdown()
   
   # 給 AI 寫指令
   prompt = f"你是分析師，這是最近5天的股票數據：{data_str}。請判斷是否買入。"
   
   response = litellm.completion(model="gemini/gemini-1.5-flash", messages=[{"content": prompt, "role": "user"}])
   print(response.choices[0].message.content)
   ```

---

## 第二步：變換為 Web 服務
將腳本放入 FastAPI：
- 使用 `@app.get("/stocks/{code}")` 作為接口。
- 返回 AI 分析的內容。

---

## 第三步：前端展示
- 使用 `Vite` 快速創建 React 項目。
- 使用 `axios.get()` 獲取你 FastAPI 提供的股票數據。
- 使用 `Tailwind CSS` 美化界面。

---

## 向本項目學習的 3 個高級技巧 (Pro Tips)
1. **JSON 修復**: LLM 輸出的 JSON 有時會多括號或少引號。使用 `json_repair` 庫可以極大地提高系統穩定性。
2. **System Prompt 隔離**: 不要把提示詞寫死在代碼裏，像本項目一樣放在配置文件或類屬性中。
3. **Environment 隔離**: 所有敏感信息（API Key）必須放在 `.env` 檔案中，絕不進入 Git 倉庫。

---
**建議**：你可以先從模仿一個「每日美股收盤分析」的小腳本開始，成功運行後再逐步增加「定時自動化」和「Web 前端」功能。
