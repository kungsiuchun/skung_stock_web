# TypeScript 股票分析器 - 策略工具需求清單

## 概述

本文檔列出了所有 11 個策略在 TypeScript 股票分析器項目中所需的工具和數據源。

## 核心工具模塊

### 1. 數據獲取工具 (Data Provider)

#### YFinanceProvider
```typescript
interface YFinanceProvider {
  getStockData(symbol: string, period: string): Promise<StockData[]>;
  getRealtimeQuote(symbol: string): Promise<RealtimeData>;
  getMarketIndices(): Promise<MarketIndex[]>;
  getSectorData(): Promise<SectorData[]>;
  searchNews(symbol: string, maxResults?: number): Promise<NewsItem[]>;
}
```

**所需功能**:
- 歷史股票數據獲取（支持不同時間週期）
- 實時行情數據
- 美股主要指數數據（SPY、QQQ、IWM）
- 板塊數據和板塊內股票列表
- 股票相關新聞搜索

### 2. 技術指標計算工具 (Technical Indicators)

#### TechnicalIndicators
```typescript
class TechnicalIndicators {
  static SMA(data: number[], period: number): number[];
  static EMA(data: number[], period: number): number[];
  static MACD(data: number[], fast?: number, slow?: number, signal?: number): MACDdata;
  static RSI(data: number[], period?: number): number[];
  static BollingerBands(data: number[], period?: number, stdDev?: number): BollingerBands;
  static VolumeRatio(data: VolumeData[], period?: number): number[];
}
```

**所需功能**:
- 移動平均線（SMA、EMA）
- MACD 指標（DIF、DEA、MACD柱）
- RSI 相對強弱指標
- 布林帶
- 量比計算

### 3. 趨勢分析工具 (Trend Analyzer)

#### StockTrendAnalyzer
```typescript
interface StockTrendAnalyzer {
  analyze(data: StockData[], code: string): TrendAnalysisResult;
  calculateMAS(data: StockData[]): DataFrame;
  calculateMACD(data: StockData[]): DataFrame;
  calculateRSI(data: StockData[]): DataFrame;
  analyzeTrend(data: StockData[], result: TrendAnalysisResult): void;
  calculateBias(result: TrendAnalysisResult): void;
  analyzeVolume(data: StockData[], result: TrendAnalysisResult): void;
  analyzeSupportResistance(data: StockData[], result: TrendAnalysisResult): void;
  generateSignal(result: TrendAnalysisResult): void;
}
```

**所需功能**:
- 均線排列分析（多頭/空頭排列）
- 趨勢強度評估
- 乖離率計算
- 量能分析（縮量/放量）
- 支撐阻力位識別
- 買賣信號生成

### 4. 新聞搜索工具 (Search Service)

#### SearchService
```typescript
interface SearchService {
  searchStockNews(symbol: string, maxResults?: number): Promise<NewsItem[]>;
  searchMarketNews(): Promise<NewsItem[]>;
  analyzeNewsSentiment(news: NewsItem[]): NewsSentiment;
  searchSectorNews(sector: string): Promise<NewsItem[]>;
}
```

**所需功能**:
- 股票新聞搜索
- 市場新聞搜索
- 新聞情緒分析
- 板塊新聞搜索

### 5. AI 分析工具 (OpenRouter Analyzer)

#### OpenRouterAnalyzer
```typescript
interface OpenRouterAnalyzer {
  isAvailable(): boolean;
  generateText(prompt: string, maxTokens?: number, temperature?: number): Promise<string | null>;
  analyze(context: AnalysisContext, newsContext?: string): Promise<AnalysisResult>;
  formatPrompt(context: AnalysisContext, name: string, newsContext?: string): string;
  parseResponse(responseText: string, code: string, name: string): AnalysisResult;
}
```

**所需功能**:
- OpenRouter API 調用
- 提示詞構建
- AI 響應解析
- 結構化結果生成

## 各策略工具需求詳情

### 1. 多頭趨勢策略 (BullTrendStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ StockTrendAnalyzer.analyze() - 趨勢分析
- ✅ TechnicalIndicators.MACD() - MACD 指標
- ✅ TechnicalIndicators.RSI() - RSI 指標

**數據需求**:
- 1年歷史數據
- 均線數據（MA5、MA10、MA20、MA60）
- MACD 指標
- RSI 指標
- 乖離率計算

### 2. 均線金叉策略 (MAGoldenCrossStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ StockTrendAnalyzer.analyze() - 趨勢分析
- ✅ TechnicalIndicators.MACD() - MACD 金叉確認

**數據需求**:
- 6個月歷史數據
- 均線交叉檢測（MA5上穿MA10）
- MACD 金叉確認
- 量能放大確認

### 3. 縮量回踩策略 (ShrinkPullbackStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ StockTrendAnalyzer.analyze() - 趨勢分析
- ✅ TechnicalIndicators.VolumeRatio() - 量比計算

**數據需求**:
- 3個月歷史數據
- 實時行情數據
- 量能縮小確認
- 均線支撐位確認
- 乖離率計算

### 4. 放量突破策略 (VolumeBreakoutStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ StockTrendAnalyzer.analyze() - 趨勢分析
- ✅ TechnicalIndicators.VolumeRatio() - 量比計算

**數據需求**:
- 3個月歷史數據
- 實時行情數據
- 阻力位識別
- 量能放大確認（>2倍）
- 突破確認

### 5. 箱體震盪策略 (BoxOscillationStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ TechnicalIndicators.BollingerBands() - 布林帶分析

**數據需求**:
- 60-120日歷史數據
- 實時行情數據
- 箱體邊界識別（支撐位/阻力位）
- 布林帶分析
- 量能確認

### 6. 龍頭策略 (DragonHeadStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getSectorData() - 板塊數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ SearchService.searchStockNews() - 新聞搜索

**數據需求**:
- 1年歷史數據
- 板塊內股票列表和表現
- 換手率數據
- 相對強度分析
- 新聞情緒分析

### 7. 情緒週期策略 (EmotionCycleStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ SearchService.searchStockNews() - 新聞搜索
- ✅ SearchService.analyzeNewsSentiment() - 情緒分析

**數據需求**:
- 20日換手率數據
- 實時行情數據
- 新聞情緒分析
- 量價結構分析
- 情緒指標量化

### 8. 纏論策略 (ChanTheoryStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ TechnicalIndicators.MACD() - MACD 背馳分析

**數據需求**:
- 60日歷史數據
- 實時行情數據
- 分型識別
- 筆和線段構建
- 中樞識別
- MACD 背馳分析

### 9. 波浪理論策略 (WaveTheoryStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ TechnicalIndicators.MACD() - MACD 分析
- ✅ FibonacciCalculator - 斐波那契比例計算

**數據需求**:
- 120日歷史數據
- 實時行情數據
- 浪型識別（5浪推動+3浪調整）
- 斐波那契比例計算
- 黃金分割位分析

### 10. 一陽夾三陰策略 (OneYangThreeYinStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ TechnicalIndicators.VolumeRatio() - 量比計算

**數據需求**:
- 10日歷史數據
- 實時行情數據
- K線形態識別
- 量能萎縮確認
- 突破確認

### 11. 底部放量策略 (BottomVolumeStrategy)

**必需工具**:
- ✅ YFinanceProvider.getStockData() - 獲取歷史數據
- ✅ YFinanceProvider.getRealtimeQuote() - 實時數據
- ✅ SearchService.searchStockNews() - 新聞搜索
- ✅ TechnicalIndicators.VolumeRatio() - 量比計算

**數據需求**:
- 30日歷史數據
- 實時行情數據
- 跌幅確認（>15%）
- 量能異動確認
- 價格企穩確認
- 基本面催化分析

## 工具依賴關係圖

```
Strategy Engine
    ↓
BaseStrategy (抽象基類)
    ↓
各具體策略
    ↓
├── YFinanceProvider (數據源)
│   ├── getStockData()
│   ├── getRealtimeQuote()
│   ├── getSectorData()
│   └── searchNews()
├── StockTrendAnalyzer (趨勢分析)
│   ├── analyze()
│   ├── calculateMAS()
│   └── analyzeVolume()
├── TechnicalIndicators (技術指標)
│   ├── SMA/EMA()
│   ├── MACD()
│   ├── RSI()
│   ├── BollingerBands()
│   └── VolumeRatio()
├── SearchService (新聞搜索)
│   ├── searchStockNews()
│   └── analyzeNewsSentiment()
└── OpenRouterAnalyzer (AI分析)
    ├── generateText()
    └── parseResponse()
```

## 實現優先級

### 第一階段（核心基礎）
1. **YFinanceProvider** - 所有策略都需要
2. **TechnicalIndicators** - 技術指標計算基礎
3. **StockTrendAnalyzer** - 趨勢分析核心

### 第二階段（策略實現）
1. **多頭趨勢策略** - 最基礎的趨勢策略
2. **均線金叉策略** - 經典技術形態
3. **縮量回踩策略** - 趨勢延續策略

### 第三階段（高級策略）
1. **箱體震盪策略** - 震盪行情策略
2. **放量突破策略** - 突破策略
3. **龍頭策略** - 板塊輪動策略

### 第四階段（複雜策略）
1. **情緒週期策略** - 市場情緒分析
2. **纏論策略** - 複雜技術分析
3. **波浪理論策略** - 高級波浪分析

### 第五階段（特殊策略）
1. **一陽夾三陰策略** - 形態識別
2. **底部放量策略** - 反轉信號

## 工具接口定義

### 數據類型定義
```typescript
interface StockData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

interface RealtimeData {
  price: number;
  volume: number;
  volumeRatio: number;
  turnoverRate: number;
  changePercent: number;
  newsSentiment?: 'positive' | 'negative' | 'neutral';
}

interface TrendAnalysisResult {
  code: string;
  trendStatus: TrendStatus;
  maAlignment: string;
  trendStrength: number;
  ma5: number; ma10: number; ma20: number; ma60: number;
  currentPrice: number;
  biasMa5: number; biasMa10: number; biasMa20: number;
  volumeStatus: VolumeStatus;
  volumeRatio5d: number;
  supportMa5: boolean; supportMa10: boolean;
  buySignal: BuySignal;
  signalScore: number;
  signalReasons: string[];
  riskFactors: string[];
  macd: MACDdata;
  rsi: RSIdata;
}
```

這個工具需求清單為 TypeScript 股票分析器的開發提供了完整的指導，確保每個策略都能獲得所需的數據和分析能力。