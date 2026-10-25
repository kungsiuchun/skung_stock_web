export interface ResearchClaim { text: string; sourceIds: string[] }
export interface ResearchReportSections { summary: ResearchClaim; support: ResearchClaim[]; counterchecks: ResearchClaim[]; risks: ResearchClaim[] }
export function researchReportSchema(sourceIds: string[]) {
  const claim = { type: "object", additionalProperties: false, required: ["text", "sourceIds"], properties: {
    text: { type: "string", minLength: 1, maxLength: 900 },
    sourceIds: { type: "array", minItems: 1, maxItems: sourceIds.length, items: { type: "string", enum: sourceIds } },
  } };
  const claims = { type: "array", minItems: 1, maxItems: 2, items: claim };
  return { type: "object", additionalProperties: false, required: ["summary", "support", "counterchecks", "risks"], properties: { summary: claim, support: claims, counterchecks: claims, risks: claims } };
}
export function validateResearchReport(value: unknown, sourceIds: string[]): ResearchReportSections {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "counterchecks,risks,summary,support") throw new Error("Research report sections are invalid.");
  const row = value as ResearchReportSections;
  const claim = (value: ResearchClaim) => {
    if (!value || Object.keys(value).sort().join(",") !== "sourceIds,text" || typeof value.text !== "string" || !value.text.trim() || value.text.length > 900
      || /https?:|<|!\[/.test(value.text) || !Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.length > 3
      || value.sourceIds.some(id => !sourceIds.includes(id)) || new Set(value.sourceIds).size !== value.sourceIds.length) throw new Error("A report claim has invalid text or source references.");
    return { text: value.text, sourceIds: [...value.sourceIds] };
  };
  const list = (values: ResearchClaim[]) => { if (!Array.isArray(values) || !values.length || values.length > 4) throw new Error("Research report evidence lists are invalid."); return values.map(claim); };
  return { summary: claim(row.summary), support: list(row.support), counterchecks: list(row.counterchecks), risks: list(row.risks) };
}
export function renderResearchReport(sections: ResearchReportSections, facts: { symbol: string; language: string; quote: number; currency: string; quoteAsOf: string; priceAsOf: string | null; gaps: string[] }) {
  const zh = facts.language !== "en";
  const claim = (value: ResearchClaim) => `${value.text} ${value.sourceIds.map(id => `[${id}]`).join(" ")}`;
  const gapText = (gap: string) => !zh ? gap : gap.startsWith("Published SEC financials") ? "無法取得已發布的 SEC 財報；不能就業務品質或估值作結論。" : gap.startsWith("Options, news") ? "本報告未包含期權、新聞或即將公布的業績；請另外檢查相關分頁。" : gap.includes("invalid price bars") ? `已排除 ${gap.match(/^\d+/)?.[0] || "部分"} 根無效價格資料；衍生價位無法使用。` : gap;
  return `# ${facts.symbol} ${zh ? "研究摘要" : "Research brief"}\n\n${zh ? "已驗證價格" : "Verified quote"}: ${facts.currency} ${facts.quote} · ${facts.quoteAsOf} [Q]\n\n${zh ? "日線資料截至" : "Daily history through"}: ${facts.priceAsOf || (zh ? "無法取得" : "Unavailable")} [T]\n\n## ${zh ? "結論" : "Summary"}\n\n${claim(sections.summary)}\n\n` +
    [[zh ? "支持證據" : "Supporting evidence", sections.support], [zh ? "反向檢查" : "Counterchecks", sections.counterchecks], [zh ? "風險與失效條件" : "Risk / invalidation", sections.risks]].map(([heading, values]) => `## ${heading}\n\n${(values as ResearchClaim[]).map(value => `- ${claim(value)}`).join("\n")}\n\n`).join("") +
    `## ${zh ? "資料缺口" : "Data gaps"}\n\n${facts.gaps.map(gap => `- ${gapText(gap)}`).join("\n")}`;
}
