/**
 * Agent Framework — Strategies
 * Cloudflare Workers alternative to reading .yaml files.
 * We store the strategy specifications as TypeScript objects containing the raw text.
 */

export interface StrategySpec {
  name: string;
  display_name: string;
  description: string;
  category: "trend" | "pattern" | "reversal" | "framework";
  core_rules: number[];
  required_tools: string[];
  instructions: string;
}

export const BULL_TREND_STRATEGY: StrategySpec = {
  name: "bull_trend",
  display_name: "默認多頭趨勢",
  description: "識別多頭排列、趨勢延續與回踩低吸機會。",
  category: "trend",
  core_rules: [1, 2, 3],
  required_tools: ["analyze_trend", "get_daily_history"],
  instructions: `
**默認多頭趨勢（Default Bull Trend Strategy）**

分析框架：
1. **趨勢確認** — 使用 analyze_trend 判斷 MA 排列，必須是多頭排列或偏多才考慮買入
2. **位置與節奏** — 觀察 RSI_14，若處於超買區間 (>70) 則優先回踩不破，避免追高
3. **量價驗證** — 檢查近期突破日是否放量
4. **消息面催化** — 透過 search_stock_news 檢查是否有近期利多消息
5. **交易建議** — 明確給出 買入/觀望/減倉 的具體原因
`
};

export const MA_GOLDEN_CROSS_STRATEGY: StrategySpec = {
  name: "ma_golden_cross",
  display_name: "均線金叉突破",
  description: "捕捉 MA5 突破 MA10 或 MA20 的短線轉強訊號。",
  category: "pattern",
  core_rules: [4, 5],
  required_tools: ["calculate_ma"],
  instructions: `
**均線金叉突破（MA Golden Cross Strategy）**

分析框架：
1. **金叉確認** — 使用 calculate_ma 檢查 MA5 是否大於 MA10 且大於 MA20
2. **轉捩點尋找** — 判斷當前是否剛剛發生金叉（短期內 MA 加速向上）
3. **風險控制** — 若跌破 MA10 則視為失敗
`
};

export const SHRINK_PULLBACK_STRATEGY: StrategySpec = {
  name: "shrink_pullback",
  display_name: "縮量回踩 (算法)",
  description: "捕捉強勢股回調至 20MA 且成交量萎縮的低吸機會。",
  category: "reversal",
  core_rules: [6],
  required_tools: ["analyze_trend"],
  instructions: `
**縮量回踩（Shrink Pullback Strategy）**

分析框架：
1. **支撐確認** — 觀察價格是否靠近 20MA 並有止跌跡象。
2. **量能萎縮** — 確認回調過程成交量明顯低於前幾日及平均值。
3. **低位介入** — 在支撐位附近且量能極度萎縮時考慮買入。
`
};

export const BOX_OSCILLATION_STRATEGY: StrategySpec = {
  name: "box_oscillation",
  display_name: "箱體震盪 (算法)",
  description: "在盤整箱體內高拋低吸。",
  category: "pattern",
  core_rules: [7],
  required_tools: ["analyze_trend"],
  instructions: `
**箱體震盪（Box Oscillation Strategy）**

分析框架：
1. **界限劃定** — 使用 analyze_trend 獲取 60d 高低點作為箱體邊界。
2. **位置判別** — 靠近箱底買入，靠近箱頂賣出。
3. **寬度檢查** — 若箱體過窄，操作空間不足，應持幣觀望。
`
};

export const VOLUME_BREAKOUT_STRATEGY: StrategySpec = {
  name: "volume_breakout",
  display_name: "放量突破 (算法)",
  description: "捕捉放量衝破關鍵阻力位的進攻訊號。",
  category: "pattern",
  core_rules: [8],
  required_tools: ["analyze_trend"],
  instructions: `
**放量突破（Volume Breakout Strategy）**

分析框架：
1. **阻力測試** — 判斷價格是否接近前高。
2. **量能爆發** — 成交量必須顯著放大（通常需大於均量 1.5 倍以上）。
3. **突破確認** — 當價格有效站穩阻力位且伴隨大量時買入。
`
};

export const DRAGON_HEAD_STRATEGY: StrategySpec = {
  name: "dragon_head",
  display_name: "龍頭策略 (算法)",
  description: "跟屬市場熱點，操作強勢趨勢中的龍頭股。",
  category: "trend",
  core_rules: [9],
  required_tools: ["analyze_trend", "get_daily_history"],
  instructions: `
**龍頭策略（Dragon Head Strategy）**

分析框架：
1. **強度判定** — 價格必須站穩所有短期均線，且呈現極強攻擊態勢。
2. **動能觀察** — RSI 指標應保持在強勢區間（>65），且資金參與度極高。
3. **情緒面** — 需配合市場熱點板塊進行分析。
`
};

export const FINANCIAL_EXPERT_STRATEGY: StrategySpec = {
  name: "financial_expert",
  display_name: "進階財務分析",
  description: "深入分析公司基本面與期權市場情緒。",
  category: "framework",
  core_rules: [],
  required_tools: ["get_financial_summary", "get_options_chain"],
  instructions: `
**進階財務分析 (Advanced Financial Expert)**

分析框架：
1. **基本面評估** — 使用 get_financial_summary 分析公司估值（P/E, PEG）、財務健康度（現金流與債備結構）及增長性。
2. **期權情緒** — 使用 get_options_chain 查看認購/認沽期權分佈、行權價聚集區及隱含波動率 (IV)，判斷市場對未來波動的預期。
3. **綜合建議** — 結合量化技術面與基本面，給出「價值」與「趨勢」兼顧的結論。
`
};

export const EMOTION_CYCLE_STRATEGY: StrategySpec = {
  name: "emotion_cycle",
  display_name: "情緒週期 (算法)",
  description: "利用量價與情緒感官判斷市場熱度。",
  category: "reversal",
  core_rules: [10],
  required_tools: ["analyze_trend"],
  instructions: `
**情緒週期（Emotion Cycle Strategy）**

分析框架：
1. **地量低位** — 觀察 RSI 與成交量，判斷是否處於恐慌盤整末期。
2. **情緒過熱** — 警惕放量滯漲與極端超買。
3. **情緒對齊** — 結合新聞情緒判斷資金意向。
`
};

export const CHAN_THEORY_STRATEGY: StrategySpec = {
  name: "chan_theory",
  display_name: "纏論策略 (算法)",
  description: "基於中樞、背馳與買賣點理論進行分析。",
  category: "pattern",
  core_rules: [11],
  required_tools: ["run_algorithmic_strategy"],
  instructions: `
**纏論策略（Chan Theory Strategy）**

分析框架：
1. **結構識別** — 判斷當前處於哪類买卖點（如第一、二、三類買點）。
2. **背馳分析** — 使用 MACD 面積或 DIF 高度判斷趨勢衰竭。
3. **區間套** — 結合多週期觀察結構精確定位。
`
};

export const WAVE_THEORY_STRATEGY: StrategySpec = {
  name: "wave_theory",
  display_name: "波浪理論 (算法)",
  description: "跟蹤 5 浪推動與 3 浪調整，定位黃金分割買賣點。",
  category: "trend",
  core_rules: [12],
  required_tools: ["run_algorithmic_strategy"],
  instructions: `
**波浪理論（Wave Theory Strategy）**

分析框架：
1. **浪型定位** — 判斷當前處於 12345 浪還是 ABC 浪。
2. **比例驗證** — 使用斐波那契回撤 (0.382/0.618) 尋找買點。
3. **主升捕捉** — 專注於捕捉第 3 浪主升段。
`
};

export const ONE_YANG_THREE_YIN_STRATEGY: StrategySpec = {
  name: "one_yang_three_yin",
  display_name: "一陽夾三陰 (算法)",
  description: "經典趨勢延續形態，識別洗盤結束信號。",
  category: "pattern",
  core_rules: [13],
  required_tools: ["run_algorithmic_strategy"],
  instructions: `
**一陽夾三陰（One Yang Three Yin Strategy）**

分析框架：
1. **形態匹配** — 大陽線起漲，中間 3 日縮量調整，再次大陽線突破。
2. **位置檢查** — 必須處於上升趨勢中的整理階段。
`
};

export const BOTTOM_VOLUME_STRATEGY: StrategySpec = {
  name: "bottom_volume",
  display_name: "底部放量 (算法)",
  description: "捕捉長期下跌後突發巨量的反轉機會。",
  category: "reversal",
  core_rules: [14],
  required_tools: ["analyze_trend"],
  instructions: `
**底部放量（Bottom Volume Strategy）**

分析框架：
1. **跌幅空間** — 漲幅回吐或長期陰跌超過 20%。
2. **異動放量** — 底部出現數倍於均量的成交量，暗示主力進場。
3. **企穩確認** — 底部放量後不再破底。
`
};

export const BUILTIN_STRATEGIES: Record<string, StrategySpec> = {
  bull_trend: BULL_TREND_STRATEGY,
  ma_golden_cross: MA_GOLDEN_CROSS_STRATEGY,
  shrink_pullback: SHRINK_PULLBACK_STRATEGY,
  box_oscillation: BOX_OSCILLATION_STRATEGY,
  volume_breakout: VOLUME_BREAKOUT_STRATEGY,
  dragon_head: DRAGON_HEAD_STRATEGY,
  emotion_cycle: EMOTION_CYCLE_STRATEGY,
  chan_theory: CHAN_THEORY_STRATEGY,
  wave_theory: WAVE_THEORY_STRATEGY,
  one_yang_three_yin: ONE_YANG_THREE_YIN_STRATEGY,
  bottom_volume: BOTTOM_VOLUME_STRATEGY,
  financial_expert: FINANCIAL_EXPERT_STRATEGY,
};
