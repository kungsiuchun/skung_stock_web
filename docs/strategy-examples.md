# TypeScript 股票分析器 - 策略使用示例

## 策略模塊概述

本文件提供了所有 11 個策略的完整使用示例，涵蓋從基礎使用到高級應用的各個場景。

## 目錄

1. [基礎使用 - 多策略並行分析](#1-基礎使用---多策略並行分析)
2. [箱體震盪策略](#2-箱體震盪策略)
3. [龍頭策略](#3-龍頭策略)
4. [情緒週期策略](#4-情緒週期策略)
5. [纏論策略](#5-纏論策略)
6. [波浪理論策略](#6-波浪理論策略)
7. [一陽夾三陰策略](#7-一陽夾三陰策略)
8. [底部放量策略](#8-底部放量策略)
9. [多頭趨勢策略](#9-多頭趨勢策略)
10. [均線金叉策略](#10-均線金叉策略)
11. [縮量回踩策略](#11-縮量回踩策略)
12. [批量股票策略分析](#12-批量股票策略分析)
13. [策略回測](#13-策略回測)

## 1. 基礎使用 - 多策略並行分析

### 1.1 初始化策略引擎

```typescript
import { StrategyEngine } from './strategies/strategy-engine';
import { BullTrendStrategy } from './strategies/bull-trend';
import { MAGoldenCrossStrategy } from './strategies/ma-golden-cross';
import { ShrinkPullbackStrategy } from './strategies/shrink-pullback';

// 初始化策略引擎
const engine = new StrategyEngine();

// 註冊多個策略
engine.registerStrategy(new BullTrendStrategy());
engine.registerStrategy(new MAGoldenCrossStrategy());
engine.registerStrategy(new ShrinkPullbackStrategy());

console.log('✅ 策略引擎初始化完成，已註冊 3 個策略');
```

### 1.2 構建分析上下文

```typescript
// 構建分析上下文
const context: StrategyContext = {
  code: 'AAPL',
  name: 'Apple Inc',
  trendResult: trendResult,        // 來自 StockTrendAnalyzer
  stockData: stockData,           // 歷史股票數據
  realtimeData: realtimeData,     // 實時行情數據
  newsData: newsData              // 新聞數據
};

console.log(`📊 準備分析 ${context.code}(${context.name})`);
```

### 1.3 執行策略分析

```typescript
// 執行所有策略分析
const results = await engine.analyzeAll(context);

// 獲取最佳策略
const bestStrategy = engine.getBestStrategy(results);

// 輸出分析結果
console.log(`=== ${context.code}(${context.name}) 策略分析報告 ===`);
console.log(`最佳策略: ${bestStrategy.strategyName}`);
console.log(`操作建議: ${bestStrategy.signal}`);
console.log(`綜合評分: ${bestStrategy.score}/100`);
console.log(`入場點位: ${bestStrategy.entryPoints.map(ep => `${ep.name}:${ep.price}`).join(' | ')}`);
console.log(`止損位: ${bestStrategy.stopLoss}`);
console.log(`目標位: ${bestStrategy.target}`);
console.log(`支持理由:`);
bestStrategy.reasons.forEach(reason => console.log(`  ${reason}`));
console.log(`風險提示:`);
bestStrategy.risks.forEach(risk => console.log(`  ${risk}`));
```

### 1.4 完整的基礎使用示例

```typescript
async function basicStrategyAnalysis() {
  try {
    // 1. 初始化組件
    const dataProvider = new YFinanceProvider();
    const stockAnalyzer = new StockTrendAnalyzer();
    const searchService = new SearchService();
    
    // 2. 獲取數據
    const stockData = await dataProvider.getStockData('AAPL', '1y');
    const trendResult = stockAnalyzer.analyze(stockData, 'AAPL');
    const realtimeData = await dataProvider.getRealtimeQuote('AAPL');
    const newsData = await searchService.searchStockNews('AAPL', 5);
    
    // 3. 初始化策略引擎
    const engine = new StrategyEngine();
    engine.registerStrategy(new BullTrendStrategy());
    engine.registerStrategy(new MAGoldenCrossStrategy());
    engine.registerStrategy(new ShrinkPullbackStrategy());
    
    // 4. 構建上下文
    const context: StrategyContext = {
      code: 'AAPL',
      name: 'Apple Inc',
      trendResult,
      stockData,
      realtimeData,
      newsData
    };
    
    // 5. 執行分析
    const results = await engine.analyzeAll(context);
    const bestStrategy = engine.getBestStrategy(results);
    
    // 6. 輸出報告
    console.log(`\n=== ${context.code}(${context.name}) 策略分析報告 ===`);
    console.log(`最佳策略: ${bestStrategy.strategyName}`);
    console.log(`操作建議: ${bestStrategy.signal}`);
    console.log(`綜合評分: ${bestStrategy.score}/100`);
    console.log(`入場點位: ${bestStrategy.entryPoints.map(ep => `${ep.name}:${ep.price}`).join(' | ')}`);
    console.log(`止損位: ${bestStrategy.stopLoss}`);
    console.log(`目標位: ${bestStrategy.target}`);
    
    console.log('\n支持理由:');
    bestStrategy.reasons.forEach(reason => console.log(`  ✅ ${reason}`));
    
    console.log('\n風險提示:');
    bestStrategy.risks.forEach(risk => console.log(`  ⚠️ ${risk}`));
    
    return bestStrategy;
    
  } catch (error) {
    console.error('策略分析失敗:', error);
    throw error;
  }
}

// 執行分析
basicStrategyAnalysis();
```

## 2. 箱體震盪策略

### 2.1 策略特點

- **適用場景**: 橫盤震盪行情
- **核心邏輯**: 箱體內價格在阻力位與支撐位之間反覆震盪
- **操作原則**: "貼著支撐買、接近阻力賣"

### 2.2 使用示例

```typescript
import { BoxOscillationStrategy } from './strategies/box-oscillation';

async function boxOscillationExample() {
  try {
    // 1. 初始化箱體策略
    const boxStrategy = new BoxOscillationStrategy();
    
    // 2. 獲取數據（需要60-120日數據）
    const dataProvider = new YFinanceProvider();
    const longTermData = await dataProvider.getStockData('MSFT', '120d'); // 120日數據
    const realtimeData = await dataProvider.getRealtimeQuote('MSFT');
    
    // 3. 構建上下文
    const boxContext: StrategyContext = {
      code: 'MSFT',
      name: 'Microsoft Corp',
      trendResult: null, // 可選
      stockData: longTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行箱體分析
    const boxResult = await boxStrategy.analyze(boxContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${boxContext.code} 箱體震盪分析 ===`);
    console.log(`箱體頂部: $${boxResult.target}`);
    console.log(`箱體底部: $${boxResult.stopLoss}`);
    console.log(`當前位置: ${boxResult.reasons.find(r => r.includes('箱底') || r.includes('箱中') || r.includes('箱頂')) || '未知'}`);
    console.log(`操作建議: ${boxResult.signal}`);
    console.log(`評分: ${boxResult.score}`);
    
    // 6. 判斷是否突破
    if (boxResult.signal === BuySignal.STRONG_BUY) {
      console.log('✅ 箱體向上突破，轉為趨勢策略');
    } else if (boxResult.signal === BuySignal.WAIT) {
      console.log('⚠️ 位於箱頂，不建議追高');
    } else if (boxResult.signal === BuySignal.SELL) {
      console.log('❌ 箱體向下突破，建議離場');
    }
    
    // 7. 箱體寬度計算
    const boxWidth = ((boxResult.target - boxResult.stopLoss) / boxResult.stopLoss) * 100;
    console.log(`箱體寬度: ${boxWidth.toFixed(2)}%`);
    
    if (boxWidth < 5) {
      console.log('⚠️ 箱體過窄，操作空間有限');
    } else if (boxWidth > 15) {
      console.log('📊 大箱體，可做更大波段');
    } else {
      console.log('✅ 標準箱體，波段操作可行');
    }
    
    return boxResult;
    
  } catch (error) {
    console.error('箱體震盪分析失敗:', error);
    throw error;
  }
}

// 執行分析
boxOscillationExample();
```

### 2.3 箱體策略的進階應用

```typescript
class AdvancedBoxStrategy {
  private strategy: BoxOscillationStrategy;
  
  constructor() {
    this.strategy = new BoxOscillationStrategy();
  }
  
  async analyzeWithVolumeConfirmation(context: StrategyContext) {
    const result = await this.strategy.analyze(context);
    
    // 檢查量能確認
    const volumeConfirmed = this.checkVolumeConfirmation(context);
    
    // 檢查假突破
    const isFakeBreakout = this.checkFakeBreakout(context);
    
    // 調整評分
    if (volumeConfirmed && !isFakeBreakout) {
      result.score += 10;
      result.reasons.push('✅ 量能確認，突破有效');
    } else if (isFakeBreakout) {
      result.score -= 15;
      result.risks.push('❌ 假突破，謹慎操作');
    }
    
    return result;
  }
  
  private checkVolumeConfirmation(context: StrategyContext): boolean {
    // 實現量能確認邏輯
    return context.realtimeData.volumeRatio > 2.0;
  }
  
  private checkFakeBreakout(context: StrategyContext): boolean {
    // 實現假突破判斷邏輯
    const currentPrice = context.realtimeData.price;
    const resistance = context.trendResult?.resistance_levels?.[0] || 0;
    return currentPrice > resistance * 1.02; // 超過阻力2%可能是假突破
  }
}
```

## 3. 龍頭策略

### 3.1 策略特點

- **適用場景**: 板塊輪動中的領漲股
- **核心邏輯**: 識別板塊啟動時的領先股票
- **關鍵指標**: 換手率、相對強度、板塊地位

### 3.2 使用示例

```typescript
import { DragonHeadStrategy } from './strategies/dragon-head';

async function dragonHeadExample() {
  try {
    // 1. 初始化龍頭策略
    const dragonStrategy = new DragonHeadStrategy();
    
    // 2. 獲取數據
    const dataProvider = new YFinanceProvider();
    const stockData = await dataProvider.getStockData('TSLA', '1y');
    const realtimeData = await dataProvider.getRealtimeQuote('TSLA');
    const sectorData = await dataProvider.getSectorData(); // 板塊數據
    const newsData = await searchService.searchStockNews('TSLA', 5);
    
    // 3. 構建上下文
    const dragonContext: StrategyContext = {
      code: 'TSLA',
      name: 'Tesla Inc',
      trendResult: null,
      stockData,
      realtimeData,
      newsData
    };
    
    // 4. 執行龍頭分析
    const dragonResult = await dragonStrategy.analyze(dragonContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${dragonContext.code} 龍頭策略分析 ===`);
    console.log(`是否龍頭: ${dragonResult.reasons.some(r => r.includes('龍頭')) ? '是' : '否'}`);
    console.log(`板塊地位: ${dragonResult.reasons.find(r => r.includes('板塊')) || '未知'}`);
    console.log(`換手率: ${dragonResult.reasons.find(r => r.includes('換手率')) || '正常'}`);
    console.log(`操作建議: ${dragonResult.signal}`);
    console.log(`評分: ${dragonResult.score}`);
    
    // 6. 龍頭特徵判斷
    const isDragonHead = dragonResult.score >= 80;
    const hasSectorRotation = dragonResult.reasons.some(r => r.includes('板塊輪動'));
    const highTurnover = dragonResult.reasons.some(r => r.includes('換手率') && r.includes('>'));
    
    if (isDragonHead) {
      console.log('⭐ 確認為龍頭股，可適度放宽標準');
      if (hasSectorRotation) {
        console.log('✅ 板塊輪動中，龍頭效應明顯');
      }
      if (highTurnover) {
        console.log('📊 換手率健康，資金活躍');
      }
    } else {
      console.log('⚠️ 非龍頭股，嚴格按照乖離率標準');
    }
    
    // 7. 龍頭策略的特殊處理
    if (isDragonHead && dragonResult.score >= 90) {
      console.log('🔥 強勢龍頭，可輕倉追蹤');
      dragonResult.entryPoints = [{
        name: '突破位',
        price: dragonResult.target * 0.98,
        type: 'buy'
      }];
    }
    
    return dragonResult;
    
  } catch (error) {
    console.error('龍頭策略分析失敗:', error);
    throw error;
  }
}

// 執行分析
dragonHeadExample();
```

### 3.3 龍頭策略的板塊分析

```typescript
class DragonHeadSectorAnalyzer {
  async analyzeSectorLeadership(symbol: string) {
    const sectorData = await this.getSectorData(symbol);
    const sectorStocks = sectorData.stocks;
    
    // 計算相對強度
    const relativeStrengths = await Promise.all(
      sectorStocks.map(async (stock) => {
        const data = await this.getStockData(stock.symbol, '1m');
        const returnRate = this.calculateReturnRate(data);
        return {
          symbol: stock.symbol,
          name: stock.name,
          returnRate,
          volumeRatio: stock.volumeRatio
        };
      })
    );
    
    // 排序找出龍頭
    relativeStrengths.sort((a, b) => b.returnRate - a.returnRate);
    
    const leader = relativeStrengths[0];
    console.log(`板塊龍頭: ${leader.symbol}(${leader.name})`);
    console.log(`漲幅: ${leader.returnRate.toFixed(2)}%`);
    console.log(`換手率: ${leader.volumeRatio.toFixed(2)}倍`);
    
    return leader;
  }
  
  private async getSectorData(symbol: string) {
    // 實現板塊數據獲取
    return {
      sector: 'Technology',
      stocks: [
        { symbol: 'AAPL', name: 'Apple', volumeRatio: 1.5 },
        { symbol: 'MSFT', name: 'Microsoft', volumeRatio: 1.2 },
        { symbol: 'TSLA', name: 'Tesla', volumeRatio: 3.5 }
      ]
    };
  }
}
```

## 4. 情緒週期策略

### 4.1 策略特點

- **核心哲學**: 市場情緒在"恐慌→貪婪"之間循環
- **關鍵指標**: 換手率、新聞情緒、量價結構
- **操作原則**: "別人恐慌我貪婪，別人貪婪我恐慌"

### 4.2 使用示例

```typescript
import { EmotionCycleStrategy } from './strategies/emotion-cycle';

async function emotionCycleExample() {
  try {
    // 1. 初始化情緒週期策略
    const emotionStrategy = new EmotionCycleStrategy();
    
    // 2. 獲取數據（需要20日換手率數據）
    const dataProvider = new YFinanceProvider();
    const stockData = await dataProvider.getStockData('NVDA', '1y');
    const realtimeData = await dataProvider.getRealtimeQuote('NVDA');
    const searchService = new SearchService();
    const newsData = await searchService.searchStockNews('NVDA', 10);
    
    // 3. 構建上下文
    const emotionContext: StrategyContext = {
      code: 'NVDA',
      name: 'NVIDIA Corp',
      trendResult: null,
      stockData,
      realtimeData,
      newsData
    };
    
    // 4. 執行情緒分析
    const emotionResult = await emotionStrategy.analyze(emotionContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${emotionContext.code} 情緒週期分析 ===`);
    console.log(`情緒階段: ${emotionResult.reasons.find(r => r.includes('情緒')) || '未知'}`);
    console.log(`換手率狀態: ${emotionResult.reasons.find(r => r.includes('換手率')) || '正常'}`);
    console.log(`新聞情緒: ${emotionResult.reasons.find(r => r.includes('新聞')) || '中性'}`);
    console.log(`操作建議: ${emotionResult.signal}`);
    console.log(`評分: ${emotionResult.score}`);
    
    // 6. 判斷情緒位置
    if (emotionResult.score >= 80) {
      console.log('🟢 情緒底部，恐慌時買入');
      console.log('💡 逆向投資時機，可逐步建倉');
    } else if (emotionResult.score <= 40) {
      console.log('🔴 情緒頂部，狂熱時謹慎');
      console.log('⚠️ 避免追高，考慮止盈');
    } else {
      console.log('🟡 情緒平穩，正常操作');
      console.log('📊 按照技術面信號操作');
    }
    
    // 7. 情緒指標詳細分析
    const turnoverRate = emotionContext.realtimeData.turnoverRate || 0;
    const volumeRatio = emotionContext.realtimeData.volumeRatio || 0;
    
    console.log(`\n詳細情緒指標:`);
    console.log(`換手率: ${turnoverRate.toFixed(2)}%`);
    console.log(`量比: ${volumeRatio.toFixed(2)}`);
    
    if (turnoverRate < 0.5) {
      console.log('✅ 換手率低，市場冷淡，潛在底部');
    } else if (turnoverRate > 5) {
      console.log('⚠️ 換手率高，市場熱度，警惕過熱');
    }
    
    if (volumeRatio > 3) {
      console.log('🔥 量能暴增，可能有主力動作');
    } else if (volumeRatio < 0.5) {
      console.log('💤 量能萎縮，市場觀望');
    }
    
    return emotionResult;
    
  } catch (error) {
    console.error('情緒週期分析失敗:', error);
    throw error;
  }
}

// 執行分析
emotionCycleExample();
```

### 4.3 情緒指標的量化分析

```typescript
class EmotionMetricsCalculator {
  calculateEmotionScore(context: StrategyContext): number {
    let score = 50; // 基礎分數
    
    // 1. 換手率指標
    const turnoverRate = context.realtimeData.turnoverRate || 0;
    if (turnoverRate < 0.5) {
      score += 20; // 低換手率，情緒底部
    } else if (turnoverRate > 5) {
      score -= 20; // 高換手率，情緒頂部
    }
    
    // 2. 量比指標
    const volumeRatio = context.realtimeData.volumeRatio || 1;
    if (volumeRatio > 3) {
      score -= 10; // 量能暴增，可能見頂
    } else if (volumeRatio < 0.5) {
      score += 10; // 量能萎縮，可能見底
    }
    
    // 3. 新聞情緒指標
    const newsSentiment = this.analyzeNewsSentiment(context.newsData);
    if (newsSentiment === 'positive') {
      score += 5;
    } else if (newsSentiment === 'negative') {
      score -= 5;
    }
    
    // 4. 價格位置指標
    const pricePosition = this.calculatePricePosition(context);
    if (pricePosition === 'bottom') {
      score += 15; // 價格低位
    } else if (pricePosition === 'top') {
      score -= 15; // 價格高位
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  private analyzeNewsSentiment(newsData: NewsItem[]): 'positive' | 'negative' | 'neutral' {
    // 實現新聞情緒分析
    const positiveKeywords = ['利好', '上漲', '突破', '業績增長'];
    const negativeKeywords = ['利空', '下跌', '虧損', '業績下滑'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    newsData.forEach(news => {
      positiveKeywords.forEach(keyword => {
        if (news.title?.includes(keyword) || news.content?.includes(keyword)) {
          positiveCount++;
        }
      });
      
      negativeKeywords.forEach(keyword => {
        if (news.title?.includes(keyword) || news.content?.includes(keyword)) {
          negativeCount++;
        }
      });
    });
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }
  
  private calculatePricePosition(context: StrategyContext): 'bottom' | 'middle' | 'top' {
    const currentPrice = context.realtimeData.price;
    const historicalPrices = context.stockData.map(d => d.close);
    const minPrice = Math.min(...historicalPrices);
    const maxPrice = Math.max(...historicalPrices);
    
    const position = (currentPrice - minPrice) / (maxPrice - minPrice);
    
    if (position < 0.3) return 'bottom';
    if (position > 0.7) return 'top';
    return 'middle';
  }
}
```

## 5. 纏論策略

### 5.1 策略特點

- **核心框架**: 分型 → 筆 → 線段 → 中樞 → 趨勢
- **關鍵信號**: 背馳、買賣點
- **操作原則**: 一買最強，二買回調，三買突破

### 5.2 使用示例

```typescript
import { ChanTheoryStrategy } from './strategies/chan-theory';

async function chanTheoryExample() {
  try {
    // 1. 初始化纏論策略
    const chanStrategy = new ChanTheoryStrategy();
    
    // 2. 獲取數據（需要60日數據）
    const dataProvider = new YFinanceProvider();
    const longTermData = await dataProvider.getStockData('AMZN', '60d'); // 60日數據
    const realtimeData = await dataProvider.getRealtimeQuote('AMZN');
    
    // 3. 構建上下文
    const chanContext: StrategyContext = {
      code: 'AMZN',
      name: 'Amazon.com Inc',
      trendResult: null,
      stockData: longTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行纏論分析
    const chanResult = await chanStrategy.analyze(chanContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${chanContext.code} 纏論分析 ===`);
    console.log(`當前結構: ${chanResult.reasons.find(r => r.includes('中樞') || r.includes('趨勢')) || '未知'}`);
    console.log(`買賣點類型: ${chanResult.reasons.find(r => r.includes('一買') || r.includes('二買') || r.includes('三買')) || '無明確買賣點'}`);
    console.log(`背馳信號: ${chanResult.reasons.find(r => r.includes('背馳')) || '無背馳'}`);
    console.log(`操作建議: ${chanResult.signal}`);
    console.log(`評分: ${chanResult.score}`);
    
    // 6. 判斷買賣點
    const hasFirstBuy = chanResult.reasons.some(r => r.includes('一買'));
    const hasSecondBuy = chanResult.reasons.some(r => r.includes('二買'));
    const hasThirdBuy = chanResult.reasons.some(r => r.includes('三買'));
    const hasBearishSignal = chanResult.reasons.some(r => r.includes('頂背馳') || r.includes('下跌'));
    
    if (hasFirstBuy) {
      console.log('⭐ 一買信號，最強買點');
      console.log('💡 跌勢末端的底背馳，勝率最高');
    } else if (hasSecondBuy) {
      console.log('✅ 二買信號，回調不破');
      console.log('💡 一買後的回調，風險較小');
    } else if (hasThirdBuy) {
      console.log('🟢 三買信號，突破確認');
      console.log('💡 中樞突破後的回踩，趨勢延續');
    } else if (hasBearishSignal) {
      console.log('🔴 看空信號，謹慎操作');
      console.log('⚠️ 可能出現頂背馳或下跌趨勢');
    } else {
      console.log('⚪ 纏論結構不明顯，等待確認');
    }
    
    // 7. 中樞分析
    const macdData = chanContext.trendResult?.macd;
    if (macdData) {
      console.log(`\nMACD 背馳分析:`);
      console.log(`DIF: ${macdData.dif}`);
      console.log(`DEA: ${macdData.dea}`);
      console.log(`MACD: ${macdData.bar}`);
      
      if (macdData.bar < 0 && Math.abs(macdData.bar)在縮小) {
        console.log('✅ 底背馳跡象，關注反轉機會');
      } else if (macdData.bar > 0 && macdData.bar在擴大) {
        console.log('📈 上漲動能充足，趨勢延續');
      }
    }
    
    return chanResult;
    
  } catch (error) {
    console.error('纏論分析失敗:', error);
    throw error;
  }
}

// 執行分析
chanTheoryExample();
```

### 5.3 纏論結構的自動識別

```typescript
class ChanStructureDetector {
  detectChanStructures(data: StockData[]): ChanStructure {
    const structures: ChanStructure[] = [];
    
    // 1. 識別分型
    const fractals = this.detectFractals(data);
    
    // 2. 構建筆
    const pens = this.buildPens(fractals);
    
    // 3. 構建線段
    const segments = this.buildSegments(pens);
    
    // 4. 識別中樞
    const centers = this.detectCenters(segments);
    
    // 5. 判斷趨勢
    const trend = this.analyzeTrend(segments);
    
    return {
      fractals,
      pens,
      segments,
      centers,
      trend
    };
  }
  
  private detectFractals(data: StockData[]): Fractal[] {
    const fractals: Fractal[] = [];
    
    for (let i = 2; i < data.length - 2; i++) {
      const current = data[i];
      const prev1 = data[i - 1];
      const prev2 = data[i - 2];
      const next1 = data[i + 1];
      const next2 = data[i + 2];
      
      // 頂分型：中間K線最高，兩側K線都低於它
      if (current.high > prev1.high && current.high > next1.high &&
          prev1.high < prev2.high && next1.high < next2.high) {
        fractals.push({
          type: 'top',
          index: i,
          price: current.high,
          date: current.date
        });
      }
      
      // 底分型：中間K線最低，兩側K線都高於它
      if (current.low < prev1.low && current.low < next1.low &&
          prev1.low > prev2.low && next1.low > next2.low) {
        fractals.push({
          type: 'bottom',
          index: i,
          price: current.low,
          date: current.date
        });
      }
    }
    
    return fractals;
  }
  
  private buildPens(fractals: Fractal[]): Pen[] {
    const pens: Pen[] = [];
    let currentPen: Pen | null = null;
    
    for (const fractal of fractals) {
      if (!currentPen) {
        currentPen = {
          start: fractal,
          end: fractal,
          direction: fractal.type === 'top' ? 'down' : 'up'
        };
      } else {
        // 檢查是否形成筆
        if ((currentPen.direction === 'up' && fractal.type === 'top') ||
            (currentPen.direction === 'down' && fractal.type === 'bottom')) {
          currentPen.end = fractal;
          pens.push(currentPen);
          
          // 開始新的筆
          currentPen = {
            start: fractal,
            end: fractal,
            direction: fractal.type === 'top' ? 'down' : 'up'
          };
        }
      }
    }
    
    return pens;
  }
}
```

## 6. 波浪理論策略

### 6.1 策略特點

- **核心原則**: 5浪推動 + 3浪調整
- **關鍵位置**: 黃金分割位、斐波那契比例
- **操作原則**: 第2浪、第4浪是買點，第5浪末端謹慎

### 6.2 使用示例

```typescript
import { WaveTheoryStrategy } from './strategies/wave-theory';

async function waveTheoryExample() {
  try {
    // 1. 初始化波浪理論策略
    const waveStrategy = new WaveTheoryStrategy();
    
    // 2. 獲取數據（需要120日數據）
    const dataProvider = new YFinanceProvider();
    const veryLongTermData = await dataProvider.getStockData('GOOGL', '120d'); // 120日數據
    const realtimeData = await dataProvider.getRealtimeQuote('GOOGL');
    
    // 3. 構建上下文
    const waveContext: StrategyContext = {
      code: 'GOOGL',
      name: 'Alphabet Inc',
      trendResult: null,
      stockData: veryLongTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行波浪分析
    const waveResult = await waveStrategy.analyze(waveContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${waveContext.code} 波浪理論分析 ===`);
    console.log(`當前浪型: ${waveResult.reasons.find(r => r.includes('第') && r.includes('浪')) || '未知'}`);
    console.log(`關鍵位置: ${waveResult.reasons.find(r => r.includes('斐波那契')) || '無明確位置'}`);
    console.log(`操作時機: ${waveResult.reasons.find(r => r.includes('買點') || r.includes('等待') || r.includes('規避')) || '未知'}`);
    console.log(`操作建議: ${waveResult.signal}`);
    console.log(`評分: ${waveResult.score}`);
    
    // 6. 判斷浪型位置
    const isWave2 = waveResult.reasons.some(r => r.includes('第2浪'));
    const isWave3 = waveResult.reasons.some(r => r.includes('第3浪'));
    const isWave4 = waveResult.reasons.some(r => r.includes('第4浪'));
    const isWave5 = waveResult.reasons.some(r => r.includes('第5浪'));
    const isCorrective = waveResult.reasons.some(r => r.includes('A浪') || r.includes('B浪') || r.includes('C浪'));
    
    if (isWave2 || isWave4) {
      console.log('🟢 調整浪底部，最佳買點');
      console.log('💡 第2浪通常回調38.2%-61.8%，第4浪不進入第1浪價格區域');
    } else if (isWave3) {
      console.log('✅ 推動浪中段，持有為主');
      console.log('📈 第3浪最強勁，通常是最長的推動浪');
    } else if (isWave5) {
      console.log('⚠️ 推動浪末端，謹慎追高');
      console.log('🔴 第5浪可能出現延長或失敗，注意風險');
    } else if (isCorrective) {
      console.log('🔄 調整浪中，耐心等待');
      console.log('📊 調整浪通常為A-B-C結構，等待新的推動浪');
    } else {
      console.log('❓ 波浪結構不明顯，繼續觀察');
    }
    
    // 7. 斐波那契比例分析
    const fibonacciLevels = this.calculateFibonacciLevels(waveContext.stockData);
    console.log(`\n斐波那契關鍵位:`);
    console.log(`38.2% 回調: $${fibonacciLevels['38.2'].toFixed(2)}`);
    console.log(`50% 回調: $${fibonacciLevels['50'].toFixed(2)}`);
    console.log(`61.8% 回調: $${fibonacciLevels['61.8'].toFixed(2)}`);
    console.log(`161.8% 延伸: $${fibonacciLevels['161.8'].toFixed(2)}`);
    
    return waveResult;
    
  } catch (error) {
    console.error('波浪理論分析失敗:', error);
    throw error;
  }
}

// 執行分析
waveTheoryExample();
```

### 6.3 斐波那契比例計算

```typescript
class FibonacciCalculator {
  calculateFibonacciLevels(data: StockData[]): Record<string, number> {
    // 找出最近的高低點
    const recentHigh = this.findRecentHigh(data);
    const recentLow = this.findRecentLow(data);
    
    const range = recentHigh.price - recentLow.price;
    
    return {
      '23.6': recentHigh.price - range * 0.236,
      '38.2': recentHigh.price - range * 0.382,
      '50': recentHigh.price - range * 0.5,
      '61.8': recentHigh.price - range * 0.618,
      '78.6': recentHigh.price - range * 0.786,
      '100': recentLow.price,
      '161.8': recentHigh.price + range * 1.618,
      '261.8': recentHigh.price + range * 2.618,
      '423.6': recentHigh.price + range * 4.236
    };
  }
  
  private findRecentHigh(data: StockData[]): { price: number; index: number } {
    let maxPrice = 0;
    let maxIndex = 0;
    
    for (let i = 0; i < data.length; i++) {
      if (data[i].high > maxPrice) {
        maxPrice = data[i].high;
        maxIndex = i;
      }
    }
    
    return { price: maxPrice, index: maxIndex };
  }
  
  private findRecentLow(data: StockData[]): { price: number; index: number } {
    let minPrice = Infinity;
    let minIndex = 0;
    
    for (let i = 0; i < data.length; i++) {
      if (data[i].low < minPrice) {
        minPrice = data[i].low;
        minIndex = i;
      }
    }
    
    return { price: minPrice, index: minIndex };
  }
  
  analyzeWaveExtensions(data: StockData[], waveNumber: number): WaveExtension {
    const fibonacci = this.calculateFibonacciLevels(data);
    
    switch (waveNumber) {
      case 1:
        return {
          type: 'wave1',
          potentialTargets: [fibonacci['161.8'], fibonacci['261.8']],
          characteristics: '第1浪通常是推動浪的起始，可能較短'
        };
      case 3:
        return {
          type: 'wave3',
          potentialTargets: [fibonacci['161.8'], fibonacci['261.8'], fibonacci['423.6']],
          characteristics: '第3浪最強勁，經常是延長浪'
        };
      case 5:
        return {
          type: 'wave5',
          potentialTargets: [fibonacci['61.8'], fibonacci['100']],
          characteristics: '第5浪可能延長或失敗，需謹慎'
        };
      default:
        return {
          type: 'unknown',
          potentialTargets: [],
          characteristics: '未知浪型'
        };
    }
  }
}
```

## 7. 一陽夾三陰策略

### 7.1 策略特點

- **形態定義**: 大陽線 → 3根小陰線 → 大陽線
- **核心邏輯**: 整理結束信號，趨勢延續
- **關鍵確認**: 量能萎縮 + 突破確認

### 7.2 使用示例

```typescript
import { OneYangThreeYinStrategy } from './strategies/one-yang-three-yin';

async function oneYangThreeYinExample() {
  try {
    // 1. 初始化一陽夾三陰策略
    const oytStrategy = new OneYangThreeYinStrategy();
    
    // 2. 獲取數據（需要10日數據）
    const dataProvider = new YFinanceProvider();
    const shortTermData = await dataProvider.getStockData('META', '10d'); // 10日數據
    const realtimeData = await dataProvider.getRealtimeQuote('META');
    
    // 3. 構建上下文
    const oytContext: StrategyContext = {
      code: 'META',
      name: 'Meta Platforms',
      trendResult: null,
      stockData: shortTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行形態分析
    const oytResult = await oytStrategy.analyze(oytContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${oytContext.code} 一陽夾三陰分析 ===`);
    console.log(`形態成立: ${oytResult.reasons.some(r => r.includes('形態成立')) ? '是' : '否'}`);
    console.log(`趨勢背景: ${oytResult.reasons.find(r => r.includes('趨勢')) || '未知'}`);
    console.log(`量能確認: ${oytResult.reasons.find(r => r.includes('量能')) || '未知'}`);
    console.log(`操作建議: ${oytResult.signal}`);
    console.log(`評分: ${oytResult.score}`);
    
    // 6. 形態有效性判斷
    const patternConfirmed = oytResult.reasons.some(r => r.includes('形態成立'));
    const trendConfirmed = oytResult.reasons.some(r => r.includes('趨勢'));
    const volumeConfirmed = oytResult.reasons.some(r => r.includes('量能'));
    
    if (patternConfirmed && trendConfirmed && volumeConfirmed) {
      console.log('✅ 形態成立，趨勢向上，可介入');
      console.log('💡 這是很好的趨勢延續信號');
    } else if (patternConfirmed && trendConfirmed) {
      console.log('⚠️ 形態成立但量能不足，等待確認');
      console.log('📊 建議等待量能放大後再介入');
    } else {
      console.log('❌ 形態不明確，繼續觀察');
      console.log('🔍 建議等待更清晰的信號');
    }
    
    // 7. 形態細節分析
    const recentCandles = oytContext.stockData.slice(-5);
    console.log(`\n最近5日K線:`);
    recentCandles.forEach((candle, index) => {
      const bodySize = Math.abs(candle.close - candle.open);
      const bodyPercent = (bodySize / candle.open) * 100;
      const isBullish = candle.close > candle.open;
      
      console.log(`第${index + 1}日: ${isBullish ? '陽' : '陰'}線, 實體${bodyPercent.toFixed(2)}%`);
    });
    
    return oytResult;
    
  } catch (error) {
    console.error('一陽夾三陰分析失敗:', error);
    throw error;
  }
}

// 執行分析
oneYangThreeYinExample();
```

### 7.3 形態識別算法

```typescript
class OneYangThreeYinDetector {
  detectPattern(data: StockData[]): PatternResult {
    if (data.length < 5) {
      return { pattern: false, details: '數據不足' };
    }
    
    // 獲取最後5根K線
    const recent5 = data.slice(-5);
    
    // 第1日：大陽線
    const day1 = recent5[0];
    const day1Body = Math.abs(day1.close - day1.open);
    const day1BodyPercent = (day1Body / day1.open) * 100;
    const isDay1Bullish = day1.close > day1.open;
    
    // 第2-4日：連續3根陰線或小K線
    const day2 = recent5[1];
    const day3 = recent5[2];
    const day4 = recent5[3];
    
    const isDay2Small = this.isSmallCandle(day2);
    const isDay3Small = this.isSmallCandle(day3);
    const isDay4Small = this.isSmallCandle(day4);
    
    // 第5日：大陽線
    const day5 = recent5[4];
    const day5Body = Math.abs(day5.close - day5.open);
    const day5BodyPercent = (day5Body / day5.open) * 100;
    const isDay5Bullish = day5.close > day5.open;
    
    // 檢查形態條件
    const condition1 = isDay1Bullish && day1BodyPercent > 2;
    const condition2 = isDay2Small && isDay3Small && isDay4Small;
    const condition3 = isDay5Bullish && day5BodyPercent > 2;
    
    // 檢查價格位置
    const supportLevel = Math.min(day1.open, day2.low, day3.low, day4.low);
    const priceHolding = day5.close > supportLevel;
    
    // 檢查量能
    const volumeShrinking = this.checkVolumeShrinking(recent5.slice(1, 4));
    const volumeConfirming = recent5[4].volume > recent5[0].volume;
    
    const pattern = condition1 && condition2 && condition3 && priceHolding;
    
    return {
      pattern,
      details: {
        day1Bullish: condition1,
        smallCandles: condition2,
        day5Bullish: condition3,
        priceHolding,
        volumeShrinking,
        volumeConfirming
      },
      confidence: this.calculateConfidence({
        pattern,
        volumeShrinking,
        volumeConfirming
      })
    };
  }
  
  private isSmallCandle(candle: StockData): boolean {
    const bodySize = Math.abs(candle.close - candle.open);
    const bodyPercent = (bodySize / candle.open) * 100;
    return bodyPercent < 1; // 實體小於1%
  }
  
  private checkVolumeShrinking(candles: StockData[]): boolean {
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].volume > candles[i - 1].volume) {
        return false;
      }
    }
    return true;
  }
  
  private calculateConfidence(result: any): number {
    let score = 0;
    
    if (result.pattern) score += 50;
    if (result.volumeShrinking) score += 25;
    if (result.volumeConfirming) score += 25;
    
    return score;
  }
}
```

## 8. 底部放量策略

### 8.1 策略特點

- **適用場景**: 長期下跌後的底部反轉
- **核心信號**: 量能異動 + 價格企穩
- **風險提示**: 反轉信號，風險高於趨勢跟蹤

### 8.2 使用示例

```typescript
import { BottomVolumeStrategy } from './strategies/bottom-volume';

async function bottomVolumeExample() {
  try {
    // 1. 初始化底部放量策略
    const bottomStrategy = new BottomVolumeStrategy();
    
    // 2. 獲取數據（需要30日數據）
    const dataProvider = new YFinanceProvider();
    const stockData = await dataProvider.getStockData('AMD', '30d'); // 30日數據
    const realtimeData = await dataProvider.getRealtimeQuote('AMD');
    const searchService = new SearchService();
    const newsData = await searchService.searchStockNews('AMD', 5);
    
    // 3. 構建上下文
    const bottomContext: StrategyContext = {
      code: 'AMD',
      name: 'Advanced Micro Devices',
      trendResult: null,
      stockData,
      realtimeData,
      newsData
    };
    
    // 4. 執行底部分析
    const bottomResult = await bottomStrategy.analyze(bottomContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${bottomContext.code} 底部放量分析 ===`);
    console.log(`跌幅確認: ${bottomResult.reasons.find(r => r.includes('跌幅')) || '未知'}`);
    console.log(`量能異動: ${bottomResult.reasons.find(r => r.includes('量能')) || '未知'}`);
    console.log(`價格企穩: ${bottomResult.reasons.find(r => r.includes('企穩')) || '未知'}`);
    console.log(`操作建議: ${bottomResult.signal}`);
    console.log(`評分: ${bottomResult.score}`);
    
    // 6. 判斷底部特徵
    const hasSignificantDecline = bottomResult.reasons.some(r => r.includes('跌幅') && r.includes('>'));
    const hasVolumeSpike = bottomResult.reasons.some(r => r.includes('量能') && r.includes('放大'));
    const hasPriceStabilization = bottomResult.reasons.some(r => r.includes('企穩'));
    const hasNewsCatalyst = bottomResult.reasons.some(r => r.includes('催化'));
    
    if (hasSignificantDecline && hasVolumeSpike && hasPriceStabilization) {
      console.log('⭐ 底部放量確認，反轉信號');
      if (hasNewsCatalyst) {
        console.log('✅ 有基本面催化，反轉概率更高');
      }
      console.log('💡 可以小倉位試探，設好止損');
    } else {
      console.log('⚠️ 底部特徵不明顯，繼續觀察');
      console.log('🔍 建議等待更明確的信號');
    }
    
    // 7. 風險控制
    console.log(`\n風險控制:`);
    console.log(`止損位: $${bottomResult.stopLoss}`);
    console.log(`目標位: $${bottomResult.target}`);
    console.log(`風險回報比: ${((bottomResult.target - bottomResult.stopLoss) / (bottomResult.stopLoss - bottomResult.entryPoints[0]?.price || bottomResult.stopLoss * 0.95)).toFixed(2)}:1`);
    
    if (bottomResult.score >= 80) {
      console.log('🟢 高置信度反轉，可適度加倉');
    } else if (bottomResult.score >= 60) {
      console.log('🟡 中等置信度，輕倉試探');
    } else {
      console.log('🔴 低置信度，保持觀望');
    }
    
    return bottomResult;
    
  } catch (error) {
    console.error('底部放量分析失敗:', error);
    throw error;
  }
}

// 執行分析
bottomVolumeExample();
```

### 8.3 底部特徵量化分析

```typescript
class BottomVolumeAnalyzer {
  analyzeBottomCharacteristics(data: StockData[], realtimeData: RealtimeData): BottomAnalysis {
    const analysis: BottomAnalysis = {
      declineConfirmed: false,
      volumeSpike: false,
      priceStabilization: false,
      newsCatalyst: false,
      score: 0
    };
    
    // 1. 跌幅確認
    const highPrice = Math.max(...data.map(d => d.high));
    const lowPrice = Math.min(...data.map(d => d.low));
    const declinePercent = ((highPrice - lowPrice) / highPrice) * 100;
    
    analysis.declineConfirmed = declinePercent > 15;
    analysis.declinePercent = declinePercent;
    
    // 2. 量能異動
    const avgVolume = data.reduce((sum, d) => sum + d.volume, 0) / data.length;
    const volumeRatio = realtimeData.volume / avgVolume;
    
    analysis.volumeSpike = volumeRatio > 3;
    analysis.volumeRatio = volumeRatio;
    
    // 3. 價格企穩
    const currentPrice = realtimeData.price;
    const supportLevel = lowPrice * 1.02; // 稍微高於最低點
    
    analysis.priceStabilization = currentPrice >= supportLevel;
    analysis.supportLevel = supportLevel;
    
    // 4. 新聞催化
    // 這部分需要結合新聞分析，這裡簡化處理
    analysis.newsCatalyst = realtimeData.newsSentiment === 'positive';
    
    // 5. 計算綜合評分
    let score = 0;
    if (analysis.declineConfirmed) score += 25;
    if (analysis.volumeSpike) score += 35;
    if (analysis.priceStabilization) score += 25;
    if (analysis.newsCatalyst) score += 15;
    
    analysis.score = score;
    
    return analysis;
  }
  
  generateBottomSignal(analysis: BottomAnalysis): Signal {
    if (analysis.score >= 80) {
      return {
        type: 'strong_buy',
        confidence: 'high',
        reason: '底部放量確認，反轉信號強烈',
        position: 'moderate'
      };
    } else if (analysis.score >= 60) {
      return {
        type: 'buy',
        confidence: 'medium',
        reason: '底部特徵明顯，可輕倉試探',
        position: 'light'
      };
    } else if (analysis.score >= 40) {
      return {
        type: 'wait',
        confidence: 'low',
        reason: '底部特徵不明顯，繼續觀察',
        position: 'none'
      };
    } else {
      return {
        type: 'sell',
        confidence: 'very_low',
        reason: '未見底部信號，保持觀望',
        position: 'none'
      };
    }
  }
}
```

## 9. 多頭趨勢策略

### 9.1 策略特點

- **核心指標**: 20日均線 + 60日均線
- **關鍵信號**: 均線多頭排列 + 股價在均線之上
- **操作原則**: 趨勢跟蹤，順勢而為

### 9.2 使用示例

```typescript
import { BullTrendStrategy } from './strategies/bull-trend';

async function bullTrendExample() {
  try {
    // 1. 初始化多頭趨勢策略
    const bullStrategy = new BullTrendStrategy();
    
    // 2. 獲取數據（需要60日數據）
    const dataProvider = new YFinanceProvider();
    const longTermData = await dataProvider.getStockData('AAPL', '60d'); // 60日數據
    const realtimeData = await dataProvider.getRealtimeQuote('AAPL');
    
    // 3. 構建上下文
    const bullContext: StrategyContext = {
      code: 'AAPL',
      name: 'Apple Inc',
      trendResult: null,
      stockData: longTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行趨勢分析
    const bullResult = await bullStrategy.analyze(bullContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${bullContext.code} 多頭趨勢分析 ===`);
    console.log(`均線排列: ${bullResult.reasons.find(r => r.includes('均線')) || '未知'}`);
    console.log(`股價位置: ${bullResult.reasons.find(r => r.includes('股價')) || '未知'}`);
    console.log(`趨勢強度: ${bullResult.reasons.find(r => r.includes('趨勢')) || '未知'}`);
    console.log(`操作建議: ${bullResult.signal}`);
    console.log(`評分: ${bullResult.score}`);
    
    // 6. 判斷趨勢狀態
    const hasBullishArrangement = bullResult.reasons.some(r => r.includes('多頭排列'));
    const priceAboveMA = bullResult.reasons.some(r => r.includes('股價在均線之上'));
    const strongTrend = bullResult.reasons.some(r => r.includes('趨勢強勁'));
    
    if (hasBullishArrangement && priceAboveMA && strongTrend) {
      console.log('✅ 多頭趨勢明確，可積極參與');
      console.log('📈 均線多頭排列，趨勢向上');
    } else if (hasBullishArrangement && priceAboveMA) {
      console.log('⚠️ 趨勢向上，但需觀察強度');
      console.log('📊 均線排列良好，關注量能配合');
    } else {
      console.log('❌ 趨勢不明確，保持觀望');
      console.log('🔍 建議等待趨勢確認');
    }
    
    // 7. 趨勢指標詳細分析
    const ma20 = this.calculateMA(bullContext.stockData, 20);
    const ma60 = this.calculateMA(bullContext.stockData, 60);
    const currentPrice = bullContext.realtimeData.price;
    
    console.log(`\n趨勢指標:`);
    console.log(`20日均線: $${ma20.toFixed(2)}`);
    console.log(`60日均線: $${ma60.toFixed(2)}`);
    console.log(`當前股價: $${currentPrice.toFixed(2)}`);
    
    if (currentPrice > ma20 && ma20 > ma60) {
      console.log('✅ 完美多頭排列，趨勢強勁');
    } else if (currentPrice > ma60) {
      console.log('🟡 股價在長期均線之上，趨勢偏多');
    } else {
      console.log('🔴 趨勢向下，謹慎操作');
    }
    
    return bullResult;
    
  } catch (error) {
    console.error('多頭趨勢分析失敗:', error);
    throw error;
  }
}

// 執行分析
bullTrendExample();
```

### 9.3 趨勢指標計算

```typescript
class BullTrendAnalyzer {
  calculateMA(data: StockData[], period: number): number {
    const sum = data.slice(-period).reduce((acc, d) => acc + d.close, 0);
    return sum / period;
  }
  
  analyzeTrendStrength(data: StockData[]): TrendStrength {
    const ma20 = this.calculateMA(data, 20);
    const ma60 = this.calculateMA(data, 60);
    const currentPrice = data[data.length - 1].close;
    
    const ma20Slope = this.calculateSlope(data.slice(-20), ma20);
    const ma60Slope = this.calculateSlope(data.slice(-60), ma60);
    
    return {
      ma20,
      ma60,
      currentPrice,
      ma20Slope,
      ma60Slope,
      isBullishArrangement: ma20 > ma60 && currentPrice > ma20,
      trendStrength: Math.abs(ma20Slope) + Math.abs(ma60Slope)
    };
  }
  
  private calculateSlope(data: StockData[], ma: number): number {
    const n = data.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = data.reduce((sum, d) => sum + d.close, 0);
    const sumXY = data.reduce((sum, d, i) => sum + i * d.close, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumX - sumX * sumX);
  }
}
```

## 10. 均線金叉策略

### 10.1 策略特點

- **核心指標**: 5日均線 + 20日均線
- **關鍵信號**: 5日均線向上穿越20日均線
- **操作原則**: 金叉買入，死叉賣出

### 10.2 使用示例

```typescript
import { MAGoldenCrossStrategy } from './strategies/ma-golden-cross';

async function maGoldenCrossExample() {
  try {
    // 1. 初始化均線金叉策略
    const maStrategy = new MAGoldenCrossStrategy();
    
    // 2. 獲取數據（需要20日數據）
    const dataProvider = new YFinanceProvider();
    const shortTermData = await dataProvider.getStockData('MSFT', '20d'); // 20日數據
    const realtimeData = await dataProvider.getRealtimeQuote('MSFT');
    
    // 3. 構建上下文
    const maContext: StrategyContext = {
      code: 'MSFT',
      name: 'Microsoft Corp',
      trendResult: null,
      stockData: shortTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行金叉分析
    const maResult = await maStrategy.analyze(maContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${maContext.code} 均線金叉分析 ===`);
    console.log(`金叉狀態: ${maResult.reasons.find(r => r.includes('金叉')) || '未知'}`);
    console.log(`均線位置: ${maResult.reasons.find(r => r.includes('均線')) || '未知'}`);
    console.log(`量能配合: ${maResult.reasons.find(r => r.includes('量能')) || '未知'}`);
    console.log(`操作建議: ${maResult.signal}`);
    console.log(`評分: ${maResult.score}`);
    
    // 6. 判斷金叉有效性
    const hasGoldenCross = maResult.reasons.some(r => r.includes('金叉'));
    const hasVolumeConfirmation = maResult.reasons.some(r => r.includes('量能放大'));
    const priceAboveMA = maResult.reasons.some(r => r.includes('股價在均線之上'));
    
    if (hasGoldenCross && hasVolumeConfirmation && priceAboveMA) {
      console.log('✅ 金叉有效，量能配合，可介入');
      console.log('💡 這是很好的買入信號');
    } else if (hasGoldenCross && hasVolumeConfirmation) {
      console.log('⚠️ 金叉成立但位置不佳，謹慎操作');
      console.log('📊 建議等待更好位置');
    } else if (hasGoldenCross) {
      console.log('🟡 金叉出現但量能不足，觀察確認');
      console.log('🔍 建議等待量能放大');
    } else {
      console.log('❌ 無金叉信號，保持觀望');
      console.log('💡 建議等待明確信號');
    }
    
    // 7. 均線詳細分析
    const ma5 = this.calculateMA(maContext.stockData, 5);
    const ma20 = this.calculateMA(maContext.stockData, 20);
    const currentPrice = maContext.realtimeData.price;
    
    console.log(`\n均線分析:`);
    console.log(`5日均線: $${ma5.toFixed(2)}`);
    console.log(`20日均線: $${ma20.toFixed(2)}`);
    console.log(`當前股價: $${currentPrice.toFixed(2)}`);
    
    const previousMA5 = this.calculateMA(maContext.stockData.slice(0, -1), 5);
    const previousMA20 = this.calculateMA(maContext.stockData.slice(0, -1), 20);
    
    if (ma5 > ma20 && previousMA5 <= previousMA20) {
      console.log('⭐ 剛剛形成金叉，信號新鮮');
    } else if (ma5 > ma20) {
      console.log('✅ 金叉持續，趨勢向上');
    } else {
      console.log('🔴 無金叉或死叉，謹慎操作');
    }
    
    return maResult;
    
  } catch (error) {
    console.error('均線金叉分析失敗:', error);
    throw error;
  }
}

// 執行分析
maGoldenCrossExample();
```

### 10.3 金叉信號驗證

```typescript
class MAGoldenCrossValidator {
  validateGoldenCross(data: StockData[]): GoldenCrossValidation {
    const ma5 = this.calculateMA(data, 5);
    const ma20 = this.calculateMA(data, 20);
    
    const previousMA5 = this.calculateMA(data.slice(0, -1), 5);
    const previousMA20 = this.calculateMA(data.slice(0, -1), 20);
    
    const hasGoldenCross = ma5 > ma20 && previousMA5 <= previousMA20;
    const hasDeathCross = ma5 < ma20 && previousMA5 >= previousMA20;
    
    return {
      currentMA5: ma5,
      currentMA20: ma20,
      previousMA5,
      previousMA20,
      hasGoldenCross,
      hasDeathCross,
      crossType: hasGoldenCross ? 'golden' : hasDeathCross ? 'death' : 'none',
      confidence: this.calculateCrossConfidence(data)
    };
  }
  
  private calculateMA(data: StockData[], period: number): number {
    const sum = data.slice(-period).reduce((acc, d) => acc + d.close, 0);
    return sum / period;
  }
  
  private calculateCrossConfidence(data: StockData[]): number {
    // 實現金叉置信度計算
    const ma5 = this.calculateMA(data, 5);
    const ma20 = this.calculateMA(data, 20);
    const distance = Math.abs(ma5 - ma20) / ma20;
    
    if (distance > 0.02) return 80; // 距離大，置信度高
    if (distance > 0.01) return 60; // 距離中等
    return 40; // 距離小，置信度低
  }
}
```

## 11. 縮量回踩策略

### 11.1 策略特點

- **核心指標**: 量能萎縮 + 均線回踩
- **關鍵信號**: 縮量回踩20日均線不破
- **操作原則**: 縮量回踩是買點，放量反彈確認

### 11.2 使用示例

```typescript
import { ShrinkPullbackStrategy } from './strategies/shrink-pullback';

async function shrinkPullbackExample() {
  try {
    // 1. 初始化縮量回踩策略
    const shrinkStrategy = new ShrinkPullbackStrategy();
    
    // 2. 獲取數據（需要20日數據）
    const dataProvider = new YFinanceProvider();
    const shortTermData = await dataProvider.getStockData('GOOGL', '20d'); // 20日數據
    const realtimeData = await dataProvider.getRealtimeQuote('GOOGL');
    
    // 3. 構建上下文
    const shrinkContext: StrategyContext = {
      code: 'GOOGL',
      name: 'Alphabet Inc',
      trendResult: null,
      stockData: shortTermData,
      realtimeData,
      newsData: []
    };
    
    // 4. 執行回踩分析
    const shrinkResult = await shrinkStrategy.analyze(shrinkContext);
    
    // 5. 輸出分析結果
    console.log(`=== ${shrinkContext.code} 縮量回踩分析 ===`);
    console.log(`回踩狀態: ${shrinkResult.reasons.find(r => r.includes('回踩')) || '未知'}`);
    console.log(`量能狀態: ${shrinkResult.reasons.find(r => r.includes('量能')) || '未知'}`);
    console.log(`支撐確認: ${shrinkResult.reasons.find(r => r.includes('支撐')) || '未知'}`);
    console.log(`操作建議: ${shrinkResult.signal}`);
    console.log(`評分: ${shrinkResult.score}`);
    
    // 6. 判斷回踩有效性
    const hasPullback = shrinkResult.reasons.some(r => r.includes('回踩'));
    const hasVolumeShrink = shrinkResult.reasons.some(r => r.includes('縮量'));
    const supportConfirmed = shrinkResult.reasons.some(r => r.includes('支撐有效'));
    
    if (hasPullback && hasVolumeShrink && supportConfirmed) {
      console.log('✅ 縮量回踩確認，支撐有效');
      console.log('💡 這是很好的買入機會');
    } else if (hasPullback && hasVolumeShrink) {
      console.log('⚠️ 縮量回踩中，等待支撐確認');
      console.log('📊 建議觀察支撐位表現');
    } else if (hasPullback) {
      console.log('🟡 回踩中但量能未縮，謹慎操作');
      console.log('🔍 建議等待量能萎縮');
    } else {
      console.log('❌ 無回踩信號，保持觀望');
      console.log('💡 建議等待明確信號');
    }
    
    // 7. 量能詳細分析
    const currentVolume = shrinkContext.realtimeData.volume;
    const avgVolume = this.calculateAverageVolume(shrinkContext.stockData, 10);
    const volumeRatio = currentVolume / avgVolume;
    
    console.log(`\n量能分析:`);
    console.log(`當前量能: ${currentVolume.toLocaleString()}`);
    console.log(`10日均量: ${avgVolume.toLocaleString()}`);
    console.log(`量能比率: ${volumeRatio.toFixed(2)}倍`);
    
    if (volumeRatio < 0.5) {
      console.log('✅ 量能大幅萎縮，回踩健康');
    } else if (volumeRatio < 1) {
      console.log('🟡 量能萎縮，回踩正常');
    } else {
      console.log('⚠️ 量能未縮，回踩需謹慎');
    }
    
    return shrinkResult;
    
  } catch (error) {
    console.error('縮量回踩分析失敗:', error);
    throw error;
  }
}

// 執行分析
shrinkPullbackExample();
```

### 11.3 回踩信號驗證

```typescript
class ShrinkPullbackValidator {
  validatePullback(data: StockData[], realtimeData: RealtimeData): PullbackValidation {
    const ma20 = this.calculateMA(data, 20);
    const currentPrice = realtimeData.price;
    const currentVolume = realtimeData.volume;
    const avgVolume = this.calculateAverageVolume(data, 10);
    const volumeRatio = currentVolume / avgVolume;
    
    const priceDistance = Math.abs(currentPrice - ma20) / ma20;
    const isPullback = priceDistance < 0.02; // 距離均線2%以內
    const isVolumeShrink = volumeRatio < 0.8; // 量能萎縮20%以上
    
    return {
      ma20,
      currentPrice,
      currentVolume,
      avgVolume,
      volumeRatio,
      priceDistance,
      isPullback,
      isVolumeShrink,
      pullbackQuality: this.calculatePullbackQuality(priceDistance, volumeRatio)
    };
  }
  
  private calculateMA(data: StockData[], period: number): number {
    const sum = data.slice(-period).reduce((acc, d) => acc + d.close, 0);
    return sum / period;
  }
  
  private calculateAverageVolume(data: StockData[], period: number): number {
    const sum = data.slice(-period).reduce((acc, d) => acc + d.volume, 0);
    return sum / period;
  }
  
  private calculatePullbackQuality(priceDistance: number, volumeRatio: number): number {
    let score = 50;
    
    // 價格距離評分
    if (priceDistance < 0.01) score += 25;
    else if (priceDistance < 0.02) score += 15;
    else if (priceDistance < 0.03) score += 5;
    
    // 量能評分
    if (volumeRatio < 0.5) score += 25;
    else if (volumeRatio < 0.8) score += 15;
    else if (volumeRatio < 1.2) score += 5;
    
    return Math.min(100, score);
  }
}
```

## 12. 批量股票策略分析

### 12.1 批量分析框架

```typescript
class BatchStrategyAnalyzer {
  private engine: StrategyEngine;
  private watchList: string[];
  
  constructor(watchList: string[]) {
    this.engine = new StrategyEngine();
    this.watchList = watchList;
    this.initializeStrategies();
  }
  
  private initializeStrategies(): void {
    this.engine.registerStrategy(new BullTrendStrategy());
    this.engine.registerStrategy(new MAGoldenCrossStrategy());
    this.engine.registerStrategy(new DragonHeadStrategy());
    this.engine.registerStrategy(new EmotionCycleStrategy());
    this.engine.registerStrategy(new BoxOscillationStrategy());
  }
  
  async analyzeAll(): Promise<BatchAnalysisResult[]> {
    console.log('=== 批量策略分析報告 ===\n');
    
    const results: BatchAnalysisResult[] = [];
    
    for (const symbol of this.watchList) {
      try {
        const result = await this.analyzeSingleStock(symbol);
        results.push(result);
        
        // 輸出簡要結果
        console.log(`${symbol} | ${result.bestStrategy.strategyName} | ${result.bestStrategy.signal} | ${result.bestStrategy.score}`);
        
        // 高評分股票詳細報告
        if (result.bestStrategy.score >= 80) {
          console.log(`  ✅ 強烈推薦: ${result.bestStrategy.reasons.join(' | ')}`);
        } else if (result.bestStrategy.score >= 60) {
          console.log(`  ⚠️ 可考慮: ${result.bestStrategy.reasons.join(' | ')}`);
        } else {
          console.log(`  ❌ 觀望: ${result.bestStrategy.risks.join(' | ')}`);
        }
        console.log('');
        
      } catch (error) {
        console.log(`${symbol} | 分析失敗: ${error.message}\n`);
        results.push({
          symbol,
          error: error.message,
          success: false
        });
      }
    }
    
    return results;
  }
  
  private async analyzeSingleStock(symbol: string): Promise<BatchAnalysisResult> {
    // 1. 獲取數據
    const dataProvider = new YFinanceProvider();
    const stockData = await dataProvider.getStockData(symbol, '1y');
    const trendResult = new StockTrendAnalyzer().analyze(stockData, symbol);
    const realtimeData = await dataProvider.getRealtimeQuote(symbol);
    const searchService = new SearchService();
    const newsData = await searchService.searchStockNews(symbol, 5);
    
    // 2. 構建上下文
    const context: StrategyContext = {
      code: symbol,
      name: symbol,
      trendResult,
      stockData,
      realtimeData,
      newsData
    };
    
    // 3. 執行策略分析
    const results = await this.engine.analyzeAll(context);
    const bestStrategy = this.engine.getBestStrategy(results);
    
    return {
      symbol,
      name: symbol,
      bestStrategy,
      allResults: results,
      success: true
    };
  }
  
  generateSummaryReport(results: BatchAnalysisResult[]): SummaryReport {
    const successfulResults = results.filter(r => r.success);
    
    const summary: SummaryReport = {
      totalStocks: this.watchList.length,
      analyzedStocks: successfulResults.length,
      strongBuyCount: 0,
      buyCount: 0,
      holdCount: 0,
      sellCount: 0,
      topRecommendations: [],
      strategyPerformance: {}
    };
    
    // 統計各類型建議
    successfulResults.forEach(result => {
      const signal = result.bestStrategy.signal;
      switch (signal) {
        case BuySignal.STRONG_BUY:
          summary.strongBuyCount++;
          break;
        case BuySignal.BUY:
          summary.buyCount++;
          break;
        case BuySignal.HOLD:
          summary.holdCount++;
          break;
        case BuySignal.SELL:
        case BuySignal.STRONG_SELL:
          summary.sellCount++;
          break;
      }
    });
    
    // 獲取最佳推薦
    summary.topRecommendations = successfulResults
      .sort((a, b) => b.bestStrategy.score - a.bestStrategy.score)
      .slice(0, 5)
      .map(r => ({
        symbol: r.symbol,
        name: r.name,
        strategy: r.bestStrategy.strategyName,
        score: r.bestStrategy.score,
        signal: r.bestStrategy.signal
      }));
    
    // 策略表現統計
    const strategyCounts = {};
    successfulResults.forEach(result => {
      const strategyName = result.bestStrategy.strategyName;
      strategyCounts[strategyName] = (strategyCounts[strategyName] || 0) + 1;
    });
    summary.strategyPerformance = strategyCounts;
    
    return summary;
  }
}

// 使用批量分析
async function runBatchAnalysis() {
  const watchList = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'AMD'];
  const analyzer = new BatchStrategyAnalyzer(watchList);
  
  try {
    const results = await analyzer.analyzeAll();
    const summary = analyzer.generateSummaryReport(results);
    
    console.log('=== 批量分析總結報告 ===');
    console.log(`總計股票: ${summary.totalStocks}`);
    console.log(`成功分析: ${summary.analyzedStocks}`);
    console.log(`強烈推薦: ${summary.strongBuyCount}`);
    console.log(`建議買入: ${summary.buyCount}`);
    console.log(`建議持有: ${summary.holdCount}`);
    console.log(`建議賣出: ${summary.sellCount}`);
    
    console.log('\n最佳推薦:');
    summary.topRecommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.symbol}(${rec.name}) - ${rec.strategy} - ${rec.signal} - ${rec.score}分`);
    });
    
    console.log('\n策略表現:');
    Object.entries(summary.strategyPerformance).forEach(([strategy, count]) => {
      console.log(`${strategy}: ${count}次`);
    });
    
    return summary;
    
  } catch (error) {
    console.error('批量分析失敗:', error);
    throw error;
  }
}

// 執行批量分析
runBatchAnalysis();
```

### 12.2 批量分析的性能優化

```typescript
class OptimizedBatchAnalyzer extends BatchStrategyAnalyzer {
  private cache: Map<string, CachedData> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分鐘緩存
  
  async analyzeAllOptimized(): Promise<BatchAnalysisResult[]> {
    console.log('=== 優化批量策略分析報告 ===\n');
    
    // 預加載共享數據
    await this.preloadSharedData();
    
    const results: BatchAnalysisResult[] = [];
    const promises: Promise<BatchAnalysisResult>[] = [];
    
    // 使用並發控制，避免過多並發請求
    const concurrencyLimit = 3;
    const chunks = this.chunkArray(this.watchList, concurrencyLimit);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(symbol => this.analyzeSingleStock(symbol));
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      
      // 輸出結果
      chunkResults.forEach(result => {
        console.log(`${result.symbol} | ${result.bestStrategy.strategyName} | ${result.bestStrategy.signal} | ${result.bestStrategy.score}`);
      });
      
      // 短暫延遲，避免API限流
      await this.sleep(1000);
    }
    
    return results;
  }
  
  private async preloadSharedData(): Promise<void> {
    console.log('預加載共享數據...');
    // 預加載大盤數據、板塊數據等共享信息
  }
  
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 13. 策略回測

### 13.1 回測框架

```typescript
class StrategyBacktester {
  private engine: StrategyEngine;
  private initialCapital: number;
  
  constructor(engine: StrategyEngine, initialCapital: number = 100000) {
    this.engine = engine;
    this.initialCapital = initialCapital;
  }
  
  async backtest(
    symbol: string,
    startDate: string,
    endDate: string,
    strategyName?: string
  ): Promise<BacktestResult> {
    console.log(`=== ${symbol} 策略回測 ===`);
    console.log(`時間範圍: ${startDate} ~ ${endDate}`);
    console.log(`初始資金: $${this.initialCapital}\n`);
    
    // 1. 獲取歷史數據
    const historicalData = await this.getHistoricalData(symbol, startDate, endDate);
    console.log(`獲取到 ${historicalData.length} 天歷史數據`);
    
    // 2. 初始化回測狀態
    let capital = this.initialCapital;
    let position = 0;
    let trades: TradeRecord[] = [];
    let dailyValues: DailyValue[] = [];
    
    // 3. 按日期回測
    for (const date of Object.keys(historicalData).sort()) {
      const dailyData = historicalData[date];
      const context = this.buildHistoricalContext(symbol, date, historicalData);
      
      // 執行策略分析
      const results = await this.engine.analyzeAll(context);
      let bestStrategy = this.engine.getBestStrategy(results);
      
      // 如果指定了特定策略，只使用該策略
      if (strategyName) {
        bestStrategy = results.find(r => r.strategyName === strategyName) || bestStrategy;
      }
      
      // 執行交易邏輯
      const action = this.determineAction(bestStrategy);
      const price = dailyData.close;
      const currentDate = new Date(date);
      
      // 記錄每日價值
      const currentValue = position > 0 ? position * price : capital;
      dailyValues.push({
        date: currentDate,
        value: currentValue,
        position: position,
        cash: capital
      });
      
      // 執行交易
      if (action === 'BUY' && position === 0 && capital > 0) {
        position = capital / price;
        capital = 0;
        trades.push({
          date: currentDate,
          action: 'BUY',
          price,
          quantity: position,
          strategy: bestStrategy.strategyName,
          reason: bestStrategy.reasons.join('; ')
        });
        console.log(`${date}: 買入 ${position.toFixed(2)} 股 @ $${price.toFixed(2)}`);
      } else if (action === 'SELL' && position > 0) {
        const sellValue = position * price;
        const profit = sellValue - this.initialCapital;
        const returnRate = (profit / this.initialCapital) * 100;
        
        trades.push({
          date: currentDate,
          action: 'SELL',
          price,
          quantity: position,
          strategy: bestStrategy.strategyName,
          profit,
          returnRate,
          reason: bestStrategy.reasons.join('; ')
        });
        console.log(`${date}: 賣出 ${position.toFixed(2)} 股 @ $${price.toFixed(2)}, 盈利: $${profit.toFixed(2)} (${returnRate.toFixed(2)}%)`);
        
        capital = sellValue;
        position = 0;
      }
    }
    
    // 4. 計算最終結果
    const finalValue = position > 0 ? position * historicalData[Object.keys(historicalData).pop()!].close : capital;
    const totalReturn = ((finalValue - this.initialCapital) / this.initialCapital) * 100;
    const winRate = this.calculateWinRate(trades);
    const maxDrawdown = this.calculateMaxDrawdown(dailyValues);
    const sharpeRatio = this.calculateSharpeRatio(dailyValues);
    
    const result: BacktestResult = {
      symbol,
      startDate,
      endDate,
      initialCapital: this.initialCapital,
      finalValue,
      totalReturn,
      trades,
      dailyValues,
      winRate,
      maxDrawdown,
      sharpeRatio,
      totalTrades: trades.length,
      winningTrades: trades.filter(t => t.profit > 0).length,
      losingTrades: trades.filter(t => t.profit < 0).length
    };
    
    // 5. 輸出回測報告
    this.printBacktestReport(result);
    
    return result;
  }
  
  private determineAction(strategy: StrategyResult): 'BUY' | 'SELL' | 'HOLD' {
    if (strategy.signal === BuySignal.STRONG_BUY || strategy.signal === BuySignal.BUY) {
      return 'BUY';
    } else if (strategy.signal === BuySignal.STRONG_SELL || strategy.signal === BuySignal.SELL) {
      return 'SELL';
    }
    return 'HOLD';
  }
  
  private calculateWinRate(trades: TradeRecord[]): number {
    if (trades.length === 0) return 0;
    const winningTrades = trades.filter(t => t.profit > 0).length;
    return (winningTrades / trades.length) * 100;
  }
  
  private calculateMaxDrawdown(dailyValues: DailyValue[]): number {
    let maxDrawdown = 0;
    let peak = dailyValues[0].value;
    
    for (const daily of dailyValues) {
      if (daily.value > peak) {
        peak = daily.value;
      }
      const drawdown = ((peak - daily.value) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }
  
  private calculateSharpeRatio(dailyValues: DailyValue[]): number {
    if (dailyValues.length < 2) return 0;
    
    // 計算日收益率
    const returns: number[] = [];
    for (let i = 1; i < dailyValues.length; i++) {
      const returnRate = (dailyValues[i].value - dailyValues[i - 1].value) / dailyValues[i - 1].value;
      returns.push(returnRate);
    }
    
    // 計算平均收益率和標準差
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // 無風險利率假設為0
    const sharpeRatio = stdDev === 0 ? 0 : avgReturn / stdDev;
    
    // 年化夏普比率
    return sharpeRatio * Math.sqrt(252); // 252個交易日
  }
  
  private printBacktestReport(result: BacktestResult): void {
    console.log('\n=== 回測報告 ===');
    console.log(`股票代碼: ${result.symbol}`);
    console.log(`時間範圍: ${result.startDate} ~ ${result.endDate}`);
    console.log(`初始資金: $${result.initialCapital.toLocaleString()}`);
    console.log(`最終價值: $${result.finalValue.toLocaleString()}`);
    console.log(`總收益率: ${result.totalReturn.toFixed(2)}%`);
    console.log(`勝率: ${result.winRate.toFixed(2)}%`);
    console.log(`最大回撤: ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`夏普比率: ${result.sharpeRatio.toFixed(2)}`);
    console.log(`交易次數: ${result.totalTrades}`);
    console.log(`盈利交易: ${result.winningTrades}`);
    console.log(`虧損交易: ${result.losingTrades}`);
    
    if (result.trades.length > 0) {
      console.log('\n交易記錄:');
      result.trades.forEach(trade => {
        const profitStr = trade.profit ? `盈利: $${trade.profit.toFixed(2)} (${trade.returnRate?.toFixed(2)}%)` : '';
        console.log(`  ${trade.date.toISOString().split('T')[0]}: ${trade.action} ${trade.quantity.toFixed(2)} 股 @ $${trade.price.toFixed(2)} ${profitStr}`);
      });
    }
  }
  
  private async getHistoricalData(symbol: string, startDate: string, endDate: string): Promise<Record<string, DailyData>> {
    // 實現歷史數據獲取
    const dataProvider = new YFinanceProvider();
    const allData = await dataProvider.getStockData(symbol, '2y');
    
    // 過濾指定時間範圍
    const filteredData: Record<string, DailyData> = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    allData.forEach(d => {
      const date = new Date(d.date);
      if (date >= start && date <= end) {
        filteredData[date.toISOString().split('T')[0]] = {
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume
        };
      }
    });
    
    return filteredData;
  }
  
  private buildHistoricalContext(symbol: string, date: string, historicalData: Record<string, DailyData>): StrategyContext {
    // 實現歷史上下文構建
    return {
      code: symbol,
      name: symbol,
      trendResult: null, // 可以計算歷史趨勢
      stockData: [], // 構建歷史數據數組
      realtimeData: null,
      newsData: []
    };
  }
}

// 使用回測
async function runBacktest() {
  const engine = new StrategyEngine();
  engine.registerStrategy(new BullTrendStrategy());
  engine.registerStrategy(new MAGoldenCrossStrategy());
  engine.registerStrategy(new ShrinkPullbackStrategy());
  
  const backtester = new StrategyBacktester(engine, 100000);
  
  try {
    const result = await backtester.backtest('AAPL', '2024-01-01', '2024-12-31');
    console.log('\n回測完成!');
    return result;
  } catch (error) {
    console.error('回測失敗:', error);
    throw error;
  }
}

// 執行回測
runBacktest();
```

### 13.2 多策略對比回測

```typescript
class MultiStrategyBacktester {
  private strategies: BaseStrategy[];
  
  constructor(strategies: BaseStrategy[]) {
    this.strategies = strategies;
  }
  
  async compareStrategies(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<StrategyComparisonResult> {
    console.log(`=== ${symbol} 多策略對比回測 ===`);
    
    const results: StrategyBacktestResult[] = [];
    
    for (const strategy of this.strategies) {
      console.log(`\n回測策略: ${strategy.displayName}`);
      
      const engine = new StrategyEngine();
      engine.registerStrategy(strategy);
      
      const backtester = new StrategyBacktester(engine, 100000);
      const result = await backtester.backtest(symbol, startDate, endDate);
      
      results.push({
        strategyName: strategy.displayName,
        backtestResult: result
      });
    }
    
    // 生成對比報告
    const comparison = this.generateComparisonReport(results);
    this.printComparisonReport(comparison);
    
    return comparison;
  }
  
  private generateComparisonReport(results: StrategyBacktestResult[]): StrategyComparisonResult {
    const comparison: StrategyComparisonResult = {
      symbol: results[0]?.backtestResult.symbol || '',
      startDate: results[0]?.backtestResult.startDate || '',
      endDate: results[0]?.backtestResult.endDate || '',
      strategies: results.map(r => ({
        name: r.strategyName,
        totalReturn: r.backtestResult.totalReturn,
        winRate: r.backtestResult.winRate,
        maxDrawdown: r.backtestResult.maxDrawdown,
        sharpeRatio: r.backtestResult.sharpeRatio,
        totalTrades: r.backtestResult.totalTrades
      }))
    };
    
    // 排序：按收益率排序
    comparison.strategies.sort((a, b) => b.totalReturn - a.totalReturn);
    
    return comparison;
  }
  
  private printComparisonReport(comparison: StrategyComparisonResult): void {
    console.log('\n=== 策略對比報告 ===');
    console.log(`股票: ${comparison.symbol}`);
    console.log(`時間: ${comparison.startDate} ~ ${comparison.endDate}`);
    console.log('\n策略排名:');
    
    comparison.strategies.forEach((strategy, index) => {
      console.log(`${index + 1}. ${strategy.name}`);
      console.log(`   總收益率: ${strategy.totalReturn.toFixed(2)}%`);
      console.log(`   勝率: ${strategy.winRate.toFixed(2)}%`);
      console.log(`   最大回撤: ${strategy.maxDrawdown.toFixed(2)}%`);
      console.log(`   夏普比率: ${strategy.sharpeRatio.toFixed(2)}`);
      console.log(`   交易次數: ${strategy.totalTrades}`);
      console.log('');
    });
  }
}

// 使用多策略對比回測
async function runMultiStrategyBacktest() {
  const strategies = [
    new BullTrendStrategy(),
    new MAGoldenCrossStrategy(),
    new ShrinkPullbackStrategy(),
    new VolumeBreakoutStrategy(),
    new DragonHeadStrategy()
  ];
  
  const backtester = new MultiStrategyBacktester(strategies);
  
  try {
    const comparison = await backtester.compareStrategies('AAPL', '2024-01-01', '2024-12-31');
    console.log('\n多策略對比回測完成!');
    return comparison;
  } catch (error) {
    console.error('多策略回測失敗:', error);
    throw error;
  }
}

// 執行多策略回測
runMultiStrategyBacktest();
```

## 總結

本文件提供了 TypeScript 股票分析器中所有 11 個策略的完整使用示例，涵蓋：

1. **基礎使用**: 多策略並行分析的完整流程
2. **各策略專用示例**: 每個策略的特點、使用場景和具體應用
3. **高級應用**: 批量分析、性能優化、歷史回測
4. **策略對比**: 多策略同時回測和性能比較

這些示例可以直接用於實際開發，幫助快速上手和理解各個策略的使用方法。