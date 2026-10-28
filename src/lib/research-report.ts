export interface ResearchClaim { text: string; sourceIds: string[] }
export interface ResearchReportSections { summary: ResearchClaim; support: ResearchClaim[]; counterchecks: ResearchClaim[]; risks: ResearchClaim[] }
const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)";
const QUANTIFIED_ENGLISH = new RegExp(`\\b${NUMBER_WORD}(?:[\\s\\p{Pd}]+(?:and|${NUMBER_WORD}))*[\\s\\p{Pd}]+(?:(?:calendar|trading|fiscal)[\\s\\p{Pd}]+)?(?:days?|weeks?|months?|years?|quarters?|dollars?|cents?|percent|hundred|thousand|million|billion|trillion)\\b`, "iu");
const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const SMALL_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
export function validateResearchClaim(value: ResearchClaim, sourceIds: string[], qualitativeOnly = false, maxClaimChars = qualitativeOnly ? 80 : 900): ResearchClaim {
  if (!value || Object.keys(value).sort().join(",") !== "sourceIds,text" || typeof value.text !== "string" || !value.text.trim() || value.text.length > maxClaimChars
    || /https?:|www\.|javascript:|data:|<|!\[|\[[^\]]*\]\s*\(/i.test(value.text)
    || !Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.length > sourceIds.length
    || value.sourceIds.some(id => !sourceIds.includes(id)) || new Set(value.sourceIds).size !== value.sourceIds.length
    || [...value.text.matchAll(/\[([A-Za-z][A-Za-z0-9_-]{0,30})\]/g)].some(match => !value.sourceIds.includes(match[1]))) throw new Error("A research claim has invalid text or source references.");
  const normalized = value.text.normalize("NFKC");
  const quantities = normalized.replace(/(?:前|上)一(?:個)?(?:季度|季|期)/gu, "previous_period");
  if (qualitativeOnly && (/[\p{N}%％]/u.test(value.text) || /[\p{N}%％]/u.test(normalized)
    || /[零〇一二三四五六七八九十百千萬億兩]+(?:個)?(?:天|日|周|週|月|年|季|倍|成|美元|元)/u.test(quantities)
    || /百分之[零〇一二三四五六七八九十百千萬億兩點]+/u.test(normalized)
    || QUANTIFIED_ENGLISH.test(normalized)
    || /\b(?:as of|dated|quarter ended|reported in|through)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(normalized))) throw new Error("Research interpretation must be qualitative; verified figures and dates are rendered separately.");
  return { text: value.text, sourceIds: [...value.sourceIds] };
}
export function researchReportSchema(sourceIds: string[], qualitativeOnly = false, maxClaimChars = qualitativeOnly ? 80 : 900) {
  const claim = { type: "object", additionalProperties: false, required: ["text", "sourceIds"], properties: {
    text: { type: "string", minLength: 1, maxLength: maxClaimChars, ...(qualitativeOnly ? { pattern: "^[^0-9%％]*$" } : {}) },
    sourceIds: { type: "array", minItems: 1, maxItems: sourceIds.length, items: { type: "string", enum: sourceIds } },
  } };
  const claims = { type: "array", minItems: 1, maxItems: qualitativeOnly ? 1 : 2, items: claim };
  return { type: "object", additionalProperties: false, required: ["summary", "support", "counterchecks", "risks"], properties: { summary: claim, support: claims, counterchecks: claims, risks: claims } };
}
export function validateResearchReport(value: unknown, sourceIds: string[], qualitativeOnly = false, maxClaimChars = qualitativeOnly ? 80 : 900): ResearchReportSections {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "counterchecks,risks,summary,support") throw new Error("Research report sections are invalid.");
  const row = value as ResearchReportSections;
  const claim = (value: ResearchClaim) => validateResearchClaim(value, sourceIds, qualitativeOnly, maxClaimChars);
  const list = (values: ResearchClaim[]) => { if (!Array.isArray(values) || !values.length || values.length > (qualitativeOnly ? 1 : 4)) throw new Error("Research report evidence lists are invalid."); return values.map(claim); };
  return { summary: claim(row.summary), support: list(row.support), counterchecks: list(row.counterchecks), risks: list(row.risks) };
}
export interface ResearchReportFacts {
  symbol: string; language: string; quote: number; currency: string; quoteAsOf: string; priceAsOf: string | null; gaps: string[];
  range20?: { currency: string; dailyClose: number; low: number | null; high: number | null; closeRelation: "inside_observed_range" | "unavailable"; positionPercentFromLow: number | null };
  technicals?: { sma20: number | null; sma50: number | null; sma200: number | null; atr14: number | null; relativeVolume: number | null; dollarVolume: number | null };
  quarters?: Array<{ date: string; currency: string | null; revenue: number | null; netIncome: number | null; operatingCashFlow: number | null; freeCashFlow: number | null; eps: number | null }>;
}
export function renderResearchDataFacts(facts: ResearchReportFacts) {
  const zh = facts.language !== "en";
  const missing = zh ? "無法取得" : "Unavailable";
  const number = (value: number | null) => value === null ? missing : (Math.abs(value) < 1 ? SMALL_NUMBER_FORMAT : NUMBER_FORMAT).format(value);
  const money = (value: number | null, currency: string | null = facts.currency) => value === null ? missing : currency === null ? `${number(value)} (${zh ? "幣別未提供" : "currency unavailable"})` : `${currency} ${Math.abs(value) >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : number(value)}`;
  const range = facts.range20;
  const rangeFact = !range ? "" : range.closeRelation === "unavailable" ? `${zh ? "20個交易日區間資料不足。" : "The 20-session range is unavailable."} [T]\n\n` :
    `${zh ? "20個交易日日線區間" : "20-session daily range"}: ${range.currency} ${number(range.low)}–${number(range.high)}; ${zh ? "末根收盤" : "last close"} ${number(range.dailyClose)} ${zh ? "位於區間內" : "is inside the range"}${range.positionPercentFromLow === null ? "" : `; ${zh ? "從低點起的區間位置" : "position from low"} ${range.positionPercentFromLow.toFixed(2)}% (0%=${zh ? "低點" : "low"}, 100%=${zh ? "高點" : "high"})`}. [T]\n\n`;
  const t = facts.technicals;
  const technicalFacts = !t ? "" : `- SMA20 / SMA50 / SMA200: ${money(t.sma20)} / ${money(t.sma50)} / ${money(t.sma200)}. [T]\n- ATR14: ${money(t.atr14)}; ${zh ? "相對成交量" : "relative volume"}: ${number(t.relativeVolume)}${t.relativeVolume === null ? "" : "×"}; ${zh ? "成交額" : "dollar turnover"}: ${money(t.dollarVolume)}. [T]\n\n`;
  const financialFacts = (facts.quarters || []).slice(0, 2).map(q => `- ${zh ? "已發布季度" : "Published quarter"} ${q.date}: ${zh ? "營收" : "revenue"} ${money(q.revenue, q.currency)}; ${zh ? "淨利" : "net income"} ${money(q.netIncome, q.currency)}; ${zh ? "營運現金流" : "operating cash flow"} ${money(q.operatingCashFlow, q.currency)}; ${zh ? "自由現金流" : "free cash flow"} ${money(q.freeCashFlow, q.currency)}; EPS ${money(q.eps, q.currency)}. [F]`).join("\n");
  return `${zh ? "已驗證價格" : "Verified quote"}: ${facts.currency} ${number(facts.quote)} · ${facts.quoteAsOf} [Q]\n\n${zh ? "日線資料截至" : "Daily history through"}: ${facts.priceAsOf || missing} [T]\n\n${rangeFact}${technicalFacts}${financialFacts}${financialFacts ? "\n\n" : ""}`;
}
export function renderResearchReport(sections: ResearchReportSections, facts: ResearchReportFacts) {
  const zh = facts.language !== "en";
  const claim = (value: ResearchClaim) => `${value.text} ${value.sourceIds.map(id => `[${id}]`).join(" ")}`;
  const gapText = (gap: string) => !zh ? gap : gap.startsWith("Published SEC financials") ? "無法取得已發布的 SEC 財報；不能就業務品質或估值作結論。" : gap.startsWith("Options, news") ? "本報告未包含期權、新聞或即將公布的業績；請另外檢查相關分頁。" : gap.includes("invalid price bars") ? `已排除 ${gap.match(/^\d+/)?.[0] || "部分"} 根無效價格資料；衍生價位無法使用。` : gap;
  return `# ${facts.symbol} ${zh ? "研究摘要" : "Research brief"}\n\n${renderResearchDataFacts(facts)}## ${zh ? "結論" : "Summary"}\n\n${claim(sections.summary)}\n\n` +
    [[zh ? "支持證據" : "Supporting evidence", sections.support], [zh ? "反向檢查" : "Counterchecks", sections.counterchecks], [zh ? "風險與失效條件" : "Risk / invalidation", sections.risks]].map(([heading, values]) => `## ${heading}\n\n${(values as ResearchClaim[]).map(value => `- ${claim(value)}`).join("\n")}\n\n`).join("") +
    `## ${zh ? "資料缺口" : "Data gaps"}\n\n${facts.gaps.map(gap => `- ${gapText(gap)}`).join("\n")}`;
}
