# Agent Skills: 0DTE Options AI Live-Trading Analysis

> Source: Summarized from the provided rule-engine document on **末日期权 AI 实盘分析：if-then 规则引擎**.  
> Disclaimer: For learning and system-design reference only. Not financial advice.

---

## 1. Market Regime Recognition

### Skill Description
The agent can identify real-time market states that affect 0DTE options trading decisions.

### Core Capabilities
- Detect **Gamma Pinning** near key strike prices.
- Detect **Theta decay dominance** when price fails to continue after entry.
- Identify **IV-driven emotional moves** that lack price confirmation.
- Recognize **liquidity breakdowns** through spread expansion, delayed fills, and order-book instability.
- Identify **dealer hedging environments** with rapid bidirectional price sweeps.
- Detect **VWAP structure failure** and trend weakening.
- Filter out weak single-candle signals without follow-through.

### Key Inputs
- VWAP
- EMA9 / EMA20
- Volume
- MACD
- RSI
- Bid/Ask spread
- Delta behavior
- IV / IV Rank
- VIX
- GEX / key strike concentration
- Higher-timeframe structure

### Typical Outputs
- `trend_regime`
- `chop_regime`
- `gamma_pinning_detected`
- `theta_decay_risk_high`
- `liquidity_risk_high`
- `mean_reversion_preferred`
- `trend_following_allowed`
- `avoid_trade`

---

## 2. Trade Decision Filtering

### Skill Description
The agent can convert raw market signals into structured trading decisions.

### Core Capabilities
- Build premarket directional bias using futures, VIX, yields, and overnight gap behavior.
- Reduce trading frequency before high-risk macro events such as CPI, FOMC, and NFP.
- Avoid chasing during the first 5 minutes after market open.
- Confirm trends using VWAP, EMA alignment, volume expansion, and MACD momentum.
- Detect false breakouts when price fails to retest and hold key levels.
- Enforce “no edge, no trade” logic when signals conflict or risk/reward is poor.
- Prioritize trades only when multiple signals align.

### Decision Logic Examples
```yaml
if:
  - price_above_vwap == true
  - ema9_gt_ema20 == true
  - volume_expansion == true
  - macd_strengthening == true
then:
  - enable_trend_following
  - increase_signal_score
else:
  - wait_and_observe
```

```yaml
if:
  - trend_unclear == true
  - signal_conflict == true
  - risk_reward_ratio < 1.5
then:
  - output_wait
  - disable_new_trade
else:
  - allow_trade_execution
```

### Typical Outputs
- `buy_call_candidate`
- `buy_put_candidate`
- `wait_and_observe`
- `avoid_chasing`
- `false_breakout_warning`
- `reduce_trade_frequency`
- `no_trade`

---

## 3. Execution and Risk Control

### Skill Description
The agent can enforce execution discipline and risk-management rules during live trading.

### Core Capabilities
- Exit or reduce exposure when a 0DTE trade fails to move within 10–15 minutes.
- Enforce hard structural stop-loss rules.
- Prevent moving stop-loss levels based on subjective opinion.
- Prevent adding to losing positions.
- Reduce position size during high-volatility or low-liquidity conditions.
- Take partial profits when gains reach predefined thresholds.
- Move remaining position stop to breakeven after partial profit-taking.
- Trigger daily circuit breakers after repeated losses or max daily drawdown.
- Freeze new entries during extreme news-driven volatility.

### Risk Rules
```yaml
if:
  - entry_time_elapsed_minutes >= 15
  - price_has_not_moved_in_expected_direction == true
  - theta_decay_active == true
then:
  - reduce_position
  - exit_trade
```

```yaml
if:
  - consecutive_losses >= 3
  - daily_loss_pct >= 3
then:
  - stop_trading_for_day
  - enter_review_mode
```

```yaml
if:
  - position_unrealized_loss == true
  - structure_not_reconfirmed == true
then:
  - disable_add_position
```

### Typical Outputs
- `close_position_immediately`
- `reduce_position_size`
- `partial_take_profit`
- `move_stop_to_breakeven`
- `disable_market_orders`
- `disable_new_trade`
- `daily_circuit_breaker_triggered`

---

## 4. Signal Quality Scoring

### Skill Description
The agent can score the quality of a trade setup based on multi-factor confirmation.

### Core Capabilities
- Increase signal score when VWAP, EMA, volume, MACD, and higher-timeframe structure align.
- Downgrade single-candle signals without volume or continuation.
- Downgrade breakouts without retest confirmation.
- Downgrade signals during Gamma pinning or dealer-hedging chop.
- Downgrade trades with poor liquidity or wide bid/ask spreads.
- Penalize trades where risk/reward is below the required threshold.

### Example Signal Score Factors
| Factor | Positive Condition | Negative Condition |
|---|---|---|
| VWAP | Price holds above/below with structure | Repeated VWAP failure |
| EMA | EMA9 and EMA20 aligned | EMA structure mixed |
| Volume | Expansion supports direction | No follow-through volume |
| MACD | Momentum strengthening | Momentum fading |
| Spread | Tight and stable | Wide or unstable |
| Higher Timeframe | Aligned with trade direction | Conflicting structure |
| Risk/Reward | Greater than 1:1.5 | Below 1:1.5 |

### Typical Outputs
- `signal_score_high`
- `signal_score_medium`
- `signal_score_low`
- `setup_invalid`
- `confirmation_required`
- `trade_priority_increased`
- `trade_priority_reduced`

---

## 5. Rule-Based Trade Governance

### Skill Description
The agent can operate as a rule engine that converts market observations into if-then decisions.

### Core Capabilities
- Apply hard rules for risk control.
- Apply soft rules for signal scoring and trade prioritization.
- Separate market recognition, decision-making, execution, and review logic.
- Output machine-readable trade instructions.
- Avoid discretionary overrides when hard rules are triggered.

### Rule Template
```yaml
rule_id: R-EXAMPLE-001
name: Example Rule
category: decision | market | risk | review
if:
  - condition_1 == true
  - condition_2 == true
then:
  - action_1
  - action_2
else:
  - fallback_action
priority: critical | high | medium | low
hard_rule: true | false
quantifiable: true | false | semi
market_regime: trend | chop | all
risk_note: "Describe the key risk"
invalid_when: "Describe when this rule should not apply"
```

---

## 6. Review, Attribution, and Rule Evolution

### Skill Description
The agent can review completed trades, classify outcomes, and improve the rule system over time.

### Core Capabilities
- Distinguish between **good losses** and **bad wins**.
- Mark losses that followed rules as acceptable system losses.
- Mark profits from rule violations as bad trades.
- Upgrade repeated profitable patterns into formal rules after enough samples.
- Convert repeated mistakes into hard restrictions.
- Reduce signal weight when recent performance deteriorates.
- Add market-regime conditions when one rule behaves differently across environments.
- Require complete trade journaling before including a trade in valid statistics.

### Review Logic Examples
```yaml
if:
  - trade_followed_system_rules == true
  - trade_result == loss
then:
  - classify_as_good_loss
  - do_not_overrule_system_emotionally
```

```yaml
if:
  - same_error_count > 5
  - loss_impact_significant == true
then:
  - upgrade_to_hard_restriction
  - add_system_alert
```

```yaml
if:
  - journal_complete == false
then:
  - exclude_from_valid_sample
```

### Typical Outputs
- `good_loss`
- `bad_win`
- `rule_violation_detected`
- `rule_weight_reduced`
- `rule_weight_increased`
- `new_rule_candidate`
- `hard_restriction_required`
- `exclude_from_statistics`

---

## 7. High-Priority Agent Guardrails

The agent should always enforce the following guardrails:

1. Do not trade without edge.
2. Do not chase the first 5 minutes after market open.
3. Do not gamble on CPI, FOMC, or NFP direction before release.
4. Do not average down losing 0DTE positions.
5. Do not move hard stops subjectively.
6. Do not ignore Theta decay.
7. Do not ignore liquidity or spread risk.
8. Do not treat a single candle as a complete signal.
9. Do not use RSI alone to fade a strong trend.
10. Do not keep trading after daily circuit breaker conditions are met.
11. Do not classify a profitable rule violation as a good trade.
12. Do not include incomplete trade records in statistical review.

---

## 8. Agent Skill Map

| Skill Area | Purpose | Main Outputs |
|---|---|---|
| Market Recognition | Classify live market state | trend, chop, gamma pin, liquidity risk |
| Decision Filtering | Select or reject setups | trade, wait, no trade, reduce frequency |
| Execution Control | Manage entries and exits | exit, reduce, stop, take profit |
| Risk Management | Protect account from catastrophic loss | circuit breaker, freeze trading, disable add |
| Signal Scoring | Rank setup quality | high score, low score, confirmation required |
| Review and Learning | Improve rules over time | good loss, bad win, rule update, weight change |

---

## 9. Compact Agent Definition

```markdown
This agent specializes in 0DTE options live-trading analysis.  
It identifies market regimes, filters trade setups, scores signal quality, enforces execution discipline, controls risk, and reviews trade outcomes using structured if-then rules.  
Its primary objective is not to maximize trade frequency, but to protect capital, avoid low-quality trades, and only act when market structure, signal quality, liquidity, and risk/reward are aligned.
```

---

## 10. Suggested Agent Roles

### Market Analyst Agent
Focuses on market state recognition, including VWAP structure, Gamma pinning, IV behavior, liquidity, trend strength, and false breakout conditions.

### Trade Decision Agent
Transforms market observations into trade decisions such as enter, wait, avoid, reduce size, or no trade.

### Risk Control Agent
Enforces hard rules around stop-loss, position sizing, Theta decay, daily drawdown, liquidity risk, and news-event freezes.

### Review Agent
Analyzes completed trades, identifies rule violations, separates good losses from bad wins, and recommends rule upgrades or downgrades.

---

## 11. Minimal Machine-Readable Skill Schema

```yaml
agent_name: 0DTE Options AI Live-Trading Analyst
primary_goal: Protect capital and execute only high-quality rule-confirmed trades
skills:
  - market_regime_recognition
  - trend_confirmation
  - false_breakout_filtering
  - theta_decay_detection
  - liquidity_risk_detection
  - signal_quality_scoring
  - trade_decision_filtering
  - position_risk_management
  - hard_stop_enforcement
  - daily_circuit_breaker
  - trade_review_attribution
  - rule_weight_adjustment
hard_guardrails:
  - no_trade_without_edge
  - no_averaging_down
  - no_subjective_stop_movement
  - no_market_orders_during_liquidity_breakdown
  - no_macro_event_gambling
  - stop_after_circuit_breaker
  - exclude_incomplete_journals_from_statistics
outputs:
  - trade_allowed
  - trade_rejected
  - wait_and_observe
  - reduce_size
  - exit_trade
  - freeze_new_entries
  - update_rule_weight
```
