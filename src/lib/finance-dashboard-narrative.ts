export const DASHBOARD_NARRATIVE_MIN_LENGTH = 500;

const REQUIRED_SECTIONS = [
  "即時行情",
  "期權鏈分析",
  "量化策略分析",
  "綜合分析結論",
  "交易建議",
] as const;

export type DashboardNarrativeStatus =
  | { status: "available" }
  | { status: "unavailable"; reason: string };

export type DashboardNarrativeValidation =
  | { valid: true }
  | { valid: false; reason: string };

export function validateDashboardNarrative(value: unknown): DashboardNarrativeValidation {
  if (typeof value !== "string") return { valid: false, reason: "AI narrative is missing." };
  const content = value.trim();
  if (!content) return { valid: false, reason: "AI narrative is empty." };
  if (content.length < DASHBOARD_NARRATIVE_MIN_LENGTH) {
    return { valid: false, reason: `AI narrative is too short (${content.length}/${DASHBOARD_NARRATIVE_MIN_LENGTH} characters).` };
  }
  if (content.startsWith("{") || content.startsWith("[")) {
    return { valid: false, reason: "AI narrative returned a structured payload instead of a report." };
  }

  const confirmationOnly = ["已成功記錄 Dashboard 決策", "決策摘要：", "Structured decision submitted."];
  if (confirmationOnly.some((phrase) => content.includes(phrase) && content.length < 900)) {
    return { valid: false, reason: "AI narrative is only a decision confirmation." };
  }

  const missingSections = REQUIRED_SECTIONS.filter((section) => !content.includes(section));
  if (missingSections.length > 0) {
    return { valid: false, reason: `AI narrative is missing sections: ${missingSections.join(", ")}.` };
  }

  const reportBody = content
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join("\n");
  const evidenceGroups = [
    /quote|最新價格|成交量|市場狀態/i,
    /options|open interest|call|put|支撐|阻力/i,
    /quant|deterministic|策略|分數|reasons/i,
    /風險|矛盾|risk|contradiction/i,
  ];
  const evidenceCount = evidenceGroups.filter((pattern) => pattern.test(reportBody)).length;
  if (evidenceCount < 3) return { valid: false, reason: "AI narrative does not contain enough source-backed analysis." };

  return { valid: true };
}

export function getDashboardNarrativeStatus(value: unknown): DashboardNarrativeStatus {
  const validation = validateDashboardNarrative(value);
  return validation.valid ? { status: "available" } : { status: "unavailable", reason: validation.reason };
}
