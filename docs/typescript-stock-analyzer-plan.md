# TypeScript 股票分析器復刻計劃

## 項目概述

基於 Python 版本的股票分析系統，使用 TypeScript 復刻核心分析功能，專注於美股市場。

### 核心模塊
- **stock-analyzer.ts**: 趨勢交易分析器（技術指標計算）
- **ai-analyzer.ts**: AI 分析器（OpenRouter API 集成）
- **market-analyzer.ts**: 大盤分析器（美股指數分析）

### 技術棧
- **語言**: TypeScript
- **數據源**: yfinance
- **AI API**: OpenRouter
- **通知**: WhatsApp
- **定時任務**: node-cron

## 項目架構

```
src/
├── core/                    # 核心分析引擎
│   ├── stock-analyzer.ts    # 趨勢交易分析器
│   ├── ai-analyzer.ts       # AI 分析器
│   └── market-analyzer.ts   # 大盤分析器
├── data/                    # 數據層
│   ├── yfinance-provider.ts # 數據提供者
│   └── types.ts            # 數據類型定義
├── services/               # 服務層
│   ├── notification.ts     # 通知服務
│   └── scheduler.ts        # 定時任務
├── utils/                  # 工具類
│   ├── indicators.ts       # 技術指標計算
│   ├── helpers.ts          # 輔助函數
│   └── config.ts          # 配置管理
└── index.ts               # 入口文件
```

## 核心模塊詳細設計

### 1. stock-analyzer.ts（趨勢交易分析器）

#### 核心職責
- 基於用戶交易理念進行技術分析
- 計算均線、MACD、RSI 等指標
- 生成買入信號和綜合評分

#### 交易理念實現
- **嚴進策略**: 乖離率 < 5% 才考慮
- **趨勢交易**: MA5 > MA10 > MA20 多頭排列
- **效率優先**: 關注籌碼結構
- **買點偏好**: 回踩 MA5/MA10 支撐

#### 關鍵類和方法

```typescript
// 數據類型定義
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
  macd: MACDData;
  rsi: RSIdata;
}

// 主要分析器類
class StockTrendAnalyzer {
  analyze(df: DataFrame, code: string): TrendAnalysisResult;
  private calculateMAS(df: DataFrame): DataFrame;
  private calculateMACD(df: DataFrame): DataFrame;
  private calculateRSI(df: DataFrame): DataFrame;
  private analyzeTrend(df: DataFrame, result: TrendAnalysisResult): void;
  private calculateBias(result: TrendAnalysisResult): void;
  private analyzeVolume(df: DataFrame, result: TrendAnalysisResult): void;
  private analyzeSupportResistance(df: DataFrame, result: TrendAnalysisResult): void;
  private generateSignal(result: TrendAnalysisResult): void;
}
```

#### 趨勢狀態枚舉

```typescript
enum TrendStatus {
  STRONG_BULL = "強勢多頭",
  BULL = "多頭排列",
  WEAK_BULL = "弱勢多頭",
  CONSOLIDATION = "盤整",
  WEAK_BEAR = "弱勢空頭",
  BEAR = "空頭排列",
  STRONG_BEAR = "強勢空頭"
}

enum BuySignal {
  STRONG_BUY = "強烈買入",
  BUY = "買入",
  HOLD = "持有",
  WAIT = "觀望",
  SELL = "賣出",
  STRONG_SELL = "強烈賣出"
}
```

### 2. ai-analyzer.ts（AI 分析器）

#### 核心職責
- 封裝 OpenRouter API 調用
- 結合技術面和消息面生成分析報告
- 解析 AI 響應為結構化結果

#### 關鍵類和方法

```typescript
interface AnalysisResult {
  code: string;
  name: string;
  sentimentScore: number;
  trendPrediction: string;
  operationAdvice: string;
  decisionType: 'buy' | 'hold' | 'sell';
  confidenceLevel: 'high' | 'medium' | 'low';
  dashboard: DashboardData;
  analysisSummary: string;
  keyPoints: string;
  riskWarning: string;
  buyReason: string;
  modelUsed: string;
  success: boolean;
  errorMessage?: string;
}

class OpenRouterAnalyzer {
  constructor(apiKey: string);
  isAvailable(): boolean;
  generateText(prompt: string, maxTokens?: number, temperature?: number): Promise<string | null>;
  analyze(context: AnalysisContext, newsContext?: string): Promise<AnalysisResult>;
  private formatPrompt(context: AnalysisContext, name: string, newsContext?: string): string;
  private parseResponse(responseText: string, code: string, name: string): AnalysisResult;
}
```

#### 決策儀表盤格式

```typescript
interface DashboardData {
  coreConclusion: {
    oneSentence: string;
    signalType: string;
    timeSensitivity: string;
    positionAdvice: {
      noPosition: string;
      hasPosition: string;
    };
  };
  dataPerspective: {
    trendStatus: {
      maAlignment: string;
      isBullish: boolean;
      trendScore: number;
    };
    pricePosition: {
      currentPrice: number;
      ma5: number; ma10: number; ma20: number;
      biasMa5: number;
      biasStatus: string;
      supportLevel: number;
      resistanceLevel: number;
    };
    volumeAnalysis: {
      volumeRatio: number;
      volumeStatus: string;
      turnoverRate: number;
      volumeMeaning: string;
    };
  };
  battlePlan: {
    sniperPoints: {
      idealBuy: string;
      secondaryBuy: string;
      stopLoss: string;
      takeProfit: string;
    };
    actionChecklist: string[];
  };
}
```

### 3. market-analyzer.ts（大盤分析器）

#### 核心職責
- 獲取美股主要指數數據（SPY、QQQ、IWM）
- 搜索市場新聞
- 生成大盤復盤報告

#### 關鍵類和方法

```typescript
interface MarketOverview {
  date: string;
  indices: MarketIndex[];
  upCount: number;
  downCount: number;
  flatCount: number;
  totalAmount: number;
  topSectors: SectorData[];
  bottomSectors: SectorData[];
}

interface MarketIndex {
  code: string;
  name: string;
  current: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  amplitude: number;
}

class USMarketAnalyzer {
  constructor(searchService?: SearchService, analyzer?: OpenRouterAnalyzer);
  getMarketOverview(): Promise<MarketOverview>;
  searchMarketNews(): Promise<NewsItem[]>;
  generateMarketReview(overview: MarketOverview, news: NewsItem[]): Promise<string>;
  private getMainIndices(): Promise<MarketIndex[]>;
  private buildReviewPrompt(overview: MarketOverview, news: NewsItem[]): string;
}
```

## 數據層設計

### yfinance-provider.ts

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

class YFinanceProvider {
  getStockData(symbol: string, period: string = '1y'): Promise<StockData[]>;
  getMarketIndices(): Promise<MarketIndex[]>;
  getSectorData(): Promise<SectorData[]>;
  searchNews(symbol: string, maxResults: number = 5): Promise<NewsItem[]>;
}
```

### 技術指標計算

```typescript
class TechnicalIndicators {
  static SMA(data: number[], period: number): number[];
  static EMA(data: number[], period: number): number[];
  static MACD(data: number[], fast: number = 12, slow: number = 26, signal: number = 9): MACDdata;
  static RSI(data: number[], period: number = 14): number[];
  static BollingerBands(data: number[], period: number = 20, stdDev: number = 2): BollingerBands;
}
```

## 服務層設計

### notification.ts（WhatsApp 通知）

```typescript
interface NotificationConfig {
  whatsappNumber: string;
  apiKey: string;
}

class WhatsAppNotifier {
  constructor(config: NotificationConfig);
  sendAnalysisResult(result: AnalysisResult): Promise<void>;
  sendMarketReview(review: string): Promise<void>;
  sendError(message: string): Promise<void>;
}
```

### scheduler.ts（定時任務）

```typescript
interface ScheduleConfig {
  analysisTime: string;    // "09:30" 開盤分析
  reviewTime: string;      // "16:00" 收盤復盤
  stocks: string[];        // 監控股票列表
}

class AnalysisScheduler {
  constructor(config: ScheduleConfig);
  start(): void;
  stop(): void;
  private scheduleAnalysis(): void;
  private scheduleReview(): void;
}
```

## 配置管理

### config.ts

```typescript
interface AppConfig {
  openRouter: {
    apiKey: string;
    model: string;
    fallbackModels: string[];
  };
  yfinance: {
    cacheTimeout: number;
  };
  analysis: {
    biasThreshold: number;    // 乖離率閾值
    volumeShrinkRatio: number; // 縮量閾值
    volumeHeavyRatio: number;  // 放量閾值
  };
  notification: {
    whatsapp: {
      number: string;
      apiKey: string;
    };
  };
  schedule: {
    analysisTime: string;
    reviewTime: string;
    stocks: string[];
  };
}
```

## 依賴包配置

```json
{
  "dependencies": {
    "yfinance": "^0.2.18",
    "openrouter": "^1.0.0",
    "node-cron": "^3.0.3",
    "whatsapp-web.js": "^1.24.0",
    "pandas-js": "^0.2.3",
    "technicalindicators": "^6.0.0",
    "dotenv": "^16.4.5",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

## 實現步驟

### 階段一：基礎框架搭建（1-2天）
1. 創建 TypeScript 項目結構
2. 配置依賴包和編譯選項
3. 實現基礎配置管理
4. 搭建日誌系統

### 階段二：數據層實現（2-3天）
1. 實現 YFinanceProvider
2. 實現技術指標計算
3. 數據緩存和錯誤處理
4. 測試數據獲取功能

### 階段三：核心分析器（3-4天）
1. 實現 StockTrendAnalyzer
2. 實現 OpenRouterAnalyzer
3. 實現 USMarketAnalyzer
4. 集成測試和調優

### 階段四：服務層和集成（2-3天）
1. 實現 WhatsApp 通知
2. 實現定時任務調度
3. 錯誤處理和重試機制
4. 完整集成測試

### 階段五：優化和文檔（1-2天）
1. 性能優化
2. 代碼重構
3. 編寫使用文檔
4. 測試用例完善

## 關鍵技術要點

### TypeScript 類型安全
- 使用嚴格的類型定義
- 實現接口隔離
- 錯誤處理類型化

### 非同步編程
- 使用 async/await
- 實現 Promise 鏈
- 錯誤捕獲和重試

### 模塊化設計
- 單一職責原則
- 依賴注入
- 接口抽象

### 配置驅動
- 環境變量管理
- 配置驗證
- 配置熱更新

## 測試策略

### 單元測試
- 使用 Jest 框架
- 測試核心算法
- 測試邊界條件

### 集成測試
- 測試數據獲取
- 測試 AI API 調用
- 測試通知功能

### 端到端測試
- 完整分析流程測試
- 定時任務測試
- 錯誤場景測試

## 部署和運維

### 環境要求
- Node.js 18+
- TypeScript 編譯環境
- 網絡連接（YFinance、OpenRouter）

### 部署方式
- 本地運行
- Docker 容器化
- 雲服務器部署

### 監控和維護
- 日誌監控
- 錯誤告警
- 性能監控

## 使用示例

### 基本使用

```typescript
import { StockTrendAnalyzer } from './core/stock-analyzer';
import { OpenRouterAnalyzer } from './core/ai-analyzer';
import { YFinanceProvider } from './data/yfinance-provider';

// 初始化組件
const dataProvider = new YFinanceProvider();
const stockAnalyzer = new StockTrendAnalyzer();
const aiAnalyzer = new OpenRouterAnalyzer(process.env.OPENROUTER_API_KEY);

// 獲取股票數據
const stockData = await dataProvider.getStockData('AAPL', '1y');

// 技術分析
const trendResult = stockAnalyzer.analyze(stockData, 'AAPL');

// AI 分析
const aiResult = await aiAnalyzer.analyze({
  code: 'AAPL',
  name: 'Apple Inc',
  today: trendResult,
  realtime: { /* 實時數據 */ }
});

console.log(aiResult.dashboard.coreConclusion.oneSentence);
```

### 定時任務

```typescript
import { AnalysisScheduler } from './services/scheduler';

const scheduler = new AnalysisScheduler({
  analysisTime: '09:30',
  reviewTime: '16:00',
  stocks: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']
});

scheduler.start();
```

## 注意事項

1. **API 限流**: YFinance 和 OpenRouter 都有調用限制，需要實現重試機制
2. **數據質量**: 美股數據可能存在缺失，需要做好容錯處理
3. **時區處理**: 美股交易時間與本地時區不同，需要正確處理
4. **錯誤恢復**: 網絡異常時需要有降級方案
5. **性能優化**: 大量股票分析時需要考慮並發控制

## 策略模塊集成

### 策略目錄結構

```
src/
├── strategies/              # 策略模塊
│   ├── base-strategy.ts     # 策略基類
│   ├── bull-trend.ts        # 多頭趨勢策略
│   ├── ma-golden-cross.ts   # 均線金叉策略
│   ├── shrink-pullback.ts   # 縮量回踩策略
│   ├── volume-breakout.ts   # 放量突破策略
│   ├── box-oscillation.ts   # 箱體震盪策略
│   ├── dragon-head.ts       # 龍頭策略
│   ├── emotion-cycle.ts     # 情緒週期策略
│   ├── chan-theory.ts       # 纏論策略
│   ├── wave-theory.ts       # 波浪理論策略
│   ├── one-yang-three-yin.ts # 一陽夾三陰策略
│   └── bottom-volume.ts     # 底部放量策略
└── strategy-engine.ts       # 策略引擎
```

### 策略基類設計

```typescript
interface StrategyContext {
  code: string;
  name: string;
  trendResult: TrendAnalysisResult;
  stockData: StockData[];
  realtimeData: RealtimeData;
  newsData: NewsItem[];
}

interface StrategyResult {
  strategyName: string;
  signal: BuySignal;
  score: number;
  reasons: string[];
  risks: string[];
  entryPoints: EntryPoint[];
  stopLoss: number;
  target: number;
}

abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly category: StrategyCategory;
  abstract readonly coreRules: number[];
  
  abstract analyze(context: StrategyContext): Promise<StrategyResult>;
  protected validateTrend(trend: TrendAnalysisResult): boolean;
  protected checkVolume(volumeRatio: number, threshold: number): boolean;
  protected checkBias(bias: number, threshold: number): boolean;
}
```

### 策略引擎

```typescript
class StrategyEngine {
  private strategies: BaseStrategy[] = [];
  
  registerStrategy(strategy: BaseStrategy): void;
  analyzeAll(context: StrategyContext): Promise<StrategyResult[]>;
  getBestStrategy(results: StrategyResult[]): StrategyResult | null;
  generateStrategyReport(results: StrategyResult[]): string;
}
```

### 策略實現示例

#### 多頭趨勢策略 (bull-trend.ts)

```typescript
class BullTrendStrategy extends BaseStrategy {
  readonly name = 'bull_trend';
  readonly displayName = '多頭趨勢';
  readonly category = StrategyCategory.TREND;
  readonly coreRules = [1, 2, 3]; // 嚴進、趨勢、效率
  
  async analyze(context: StrategyContext): Promise<StrategyResult> {
    const { trendResult } = context;
    
    // 趨勢確認
    const isBullish = trendResult.trendStatus === TrendStatus.BULL || 
                     trendResult.trendStatus === TrendStatus.STRONG_BULL;
    
    // 位置判斷
    const biasOk = Math.abs(trendResult.biasMa5) < 5;
    
    // 量能驗證
    const volumeOk = trendResult.volumeStatus === VolumeStatus.SHRINK_VOLUME_DOWN ||
                    trendResult.volumeStatus === VolumeStatus.HEAVY_VOLUME_UP;
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    if (isBullish && biasOk && volumeOk) {
      signal = BuySignal.BUY;
      score = 75;
      reasons.push('✅ 多頭排列，趨勢向上');
      reasons.push('✅ 乖離率合理，不追高');
      reasons.push('✅ 量能配合，健康上漲');
    } else if (isBullish && !biasOk) {
      signal = BuySignal.WAIT;
      score = 60;
      reasons.push('✅ 趨勢向上');
      risks.push('⚠️ 乖離率過大，等待回踩');
    } else {
      signal = BuySignal.SELL;
      score = 30;
      risks.push('❌ 趨勢不明或向下');
    }
    
    return {
      strategyName: this.displayName,
      signal,
      score,
      reasons,
      risks,
      entryPoints: this.calculateEntryPoints(trendResult),
      stopLoss: trendResult.ma20 * 0.97,
      target: trendResult.ma5 * 1.05
    };
  }
}
```

#### 均線金叉策略 (ma-golden-cross.ts)

```typescript
class MAGoldenCrossStrategy extends BaseStrategy {
  readonly name = 'ma_golden_cross';
  readonly displayName = '均線金叉';
  readonly category = StrategyCategory.TREND;
  readonly coreRules = [1, 2, 3];
  
  async analyze(context: StrategyContext): Promise<StrategyResult> {
    const { trendResult } = context;
    
    // 檢查金叉
    const ma5AboveMa10 = trendResult.ma5 > trendResult.ma10;
    const ma10AboveMa20 = trendResult.ma10 > trendResult.ma20;
    const isGoldenCross = ma5AboveMa10 && ma10AboveMa20;
    
    // 量能確認
    const volumeConfirmed = trendResult.volumeRatio5d > 1.2;
    
    // MACD 金叉
    const macdGolden = trendResult.macd_status === MACDStatus.GOLDEN_CROSS ||
                      trendResult.macd_status === MACDStatus.GOLDEN_CROSS_ZERO;
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    if (isGoldenCross && volumeConfirmed) {
      signal = BuySignal.BUY;
      score = 80;
      reasons.push('✅ MA5 上穿 MA10，金叉形成');
      reasons.push('✅ 量能放大，確認有效');
      
      if (macdGolden) {
        score += 10;
        reasons.push('✅ MACD 金叉共振');
      }
    } else if (isGoldenCross && !volumeConfirmed) {
      signal = BuySignal.WAIT;
      score = 65;
      reasons.push('✅ 金叉形成');
      risks.push('⚠️ 量能不足，需確認');
    } else {
      signal = BuySignal.SELL;
      score = 25;
      risks.push('❌ 未形成有效金叉');
    }
    
    return {
      strategyName: this.displayName,
      signal,
      score,
      reasons,
      risks,
      entryPoints: this.calculateEntryPoints(trendResult),
      stopLoss: trendResult.ma10 * 0.98,
      target: trendResult.ma5 * 1.10
    };
  }
}
```

### 策略集成到 AI 分析器

```typescript
class OpenRouterAnalyzer {
  private strategyEngine: StrategyEngine;
  
  constructor(apiKey: string) {
    this.strategyEngine = new StrategyEngine();
    this.registerStrategies();
  }
  
  private registerStrategies(): void {
    this.strategyEngine.registerStrategy(new BullTrendStrategy());
    this.strategyEngine.registerStrategy(new MAGoldenCrossStrategy());
    this.strategyEngine.registerStrategy(new ShrinkPullbackStrategy());
    // ... 註冊其他策略
  }
  
  async analyze(context: AnalysisContext, newsContext?: string): Promise<AnalysisResult> {
    // 執行所有策略分析
    const strategyResults = await this.strategyEngine.analyzeAll(context);
    
    // 獲取最佳策略
    const bestStrategy = this.strategyEngine.getBestStrategy(strategyResults);
    
    // 生成 AI 分析報告（包含策略結果）
    const prompt = this.buildStrategyPrompt(context, strategyResults, newsContext);
    const response = await this.generateText(prompt);
    
    // 解析結果
    const result = this.parseResponse(response, context.code, context.name);
    
    // 添加策略信息
    if (bestStrategy) {
      result.dashboard.strategyInsights = {
        bestStrategy: bestStrategy.strategyName,
        strategyScore: bestStrategy.score,
        strategyReasons: bestStrategy.reasons,
        entryPoints: bestStrategy.entryPoints,
        stopLoss: bestStrategy.stopLoss,
        target: bestStrategy.target
      };
    }
    
    return result;
  }
}
```

### 策略配置文件

```typescript
// strategy-config.ts
export const STRATEGY_CONFIG = {
  bull_trend: {
    name: 'bull_trend',
    display_name: '多頭趨勢',
    description: '默認個股分析優先策略，識別多頭排列、趨勢延續與回踩低吸機會。',
    category: 'trend',
    core_rules: [1, 2, 3],
    required_tools: ['get_daily_history', 'analyze_trend']
  },
  ma_golden_cross: {
    name: 'ma_golden_cross',
    display_name: '均線金叉',
    description: '檢測均線金叉配合量能確認信號，經典的趨勢反轉/延續信號。',
    category: 'trend',
    core_rules: [1, 2, 3],
    required_tools: ['get_daily_history', 'analyze_trend']
  },
  shrink_pullback: {
    name: 'shrink_pullback',
    display_name: '縮量回踩',
    description: '檢測縮量回踩均線支撐信號，趨勢延續的理想入場點。',
    category: 'trend',
    core_rules: [1, 2, 4],
    required_tools: ['get_daily_history', 'analyze_trend', 'get_realtime_quote']
  },
  // ... 其他策略配置
};
```

### 策略使用示例

```typescript
import { StrategyEngine } from './strategies/strategy-engine';
import { BullTrendStrategy } from './strategies/bull-trend';

// 初始化策略引擎
const engine = new StrategyEngine();
engine.registerStrategy(new BullTrendStrategy());

// 執行策略分析
const context: StrategyContext = {
  code: 'AAPL',
  name: 'Apple Inc',
  trendResult: trendResult,
  stockData: stockData,
  realtimeData: realtimeData,
  newsData: newsData
};

const results = await engine.analyzeAll(context);
const bestStrategy = engine.getBestStrategy(results);

console.log(`最佳策略: ${bestStrategy.strategyName}`);
console.log(`建議: ${bestStrategy.signal}`);
console.log(`評分: ${bestStrategy.score}`);
console.log(`入場點: ${bestStrategy.entryPoints.map(ep => ep.price)}`);
console.log(`止損: ${bestStrategy.stopLoss}`);
console.log(`目標: ${bestStrategy.target}`);
```

## 擴展建議

1. **策略回測**: 添加歷史數據回測功能
2. **多市場支持**: 擴展到港股、歐股等市場
3. **Web UI**: 添加可視化界面
4. **數據庫**: 添加數據持久化
5. **機器學習**: 集成更先進的預測模型

---

這個計劃提供了完整的 TypeScript 復刻方案，專注於美股市場的核心分析功能。您可以根據這個計劃逐步實現，也可以針對特定模塊進行調整。