export type TimelineStatus = "win" | "loss" | "flat" | "defense" | "ic" | "entry" | "pending";

export type RecapEventType = "entry" | "exit" | "defense" | "ic" | "hold" | "unknown";
export type RecapPositionSide = "CALL" | "PUT" | "IC" | "NONE";

export interface ActionLogItem {
  time?: string;
  price?: number;
  action?: string;
  reasoning?: string;
  pnl?: number;
}

export interface DailyMemory {
  actionLog?: ActionLogItem[];
}

export interface TimelineItem {
  id: string;
  date: string;
  ordinal: number;
  time: string;
  timestamp: string | null;
  price: number | null;
  action: string;
  reasoning: string;
  pnl: number | null;
  status: TimelineStatus;
  eventType: RecapEventType;
  positionSide: RecapPositionSide;
  relatedEntryId: string | null;
  rawJson: string;
}

export interface RecapSummary {
  totalCallouts: number;
  tradesTaken: number;
  wins: number;
  losses: number;
  flatCloses: number;
  winRate: number | null;
  totalPnlPoints: number;
  defensiveHolds: number;
  icEvents: number;
}

export interface NormalizedRecapDay {
  date: string;
  summary: RecapSummary;
  timeline: TimelineItem[];
  firstCalloutAt: string | null;
  lastCalloutAt: string | null;
}

export interface AuditPayload {
  date: string;
  generatedAt: string | null;
  report: string;
  learnedRules: string[];
  actionLogSize: number | null;
}

export interface DayAnalyticsItem extends RecapSummary {
  date: string;
  firstCalloutAt: string | null;
  lastCalloutAt: string | null;
}

export const emptySummary: RecapSummary = {
  totalCallouts: 0,
  tradesTaken: 0,
  wins: 0,
  losses: 0,
  flatCloses: 0,
  winRate: null,
  totalPnlPoints: 0,
  defensiveHolds: 0,
  icEvents: 0,
};

export const toDateKey = (key: string) => key.replace("spx_memory_", "");

export const isValidDate = (date: string | null) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));

export const parseDateFromTimestamp = (value: string | undefined) => {
  const match = value?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

export const formatTime = (value: string | undefined) => {
  const match = value?.match(/(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "--:--";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};

export const makeCalloutId = (date: string, ordinal: number) => `${date}-${String(ordinal).padStart(3, "0")}`;

export const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const includesAny = (value: string, needles: string[]) => needles.some((needle) => value.includes(needle));
const observedNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const classifyStatus = (item: ActionLogItem): TimelineStatus => {
  const action = item.action || "";
  const actionLower = action.toLowerCase();
  const pnl = observedNumber(item.pnl);

  if (pnl !== null) {
    if (pnl > 0) return "win";
    if (pnl < 0) return "loss";
    return "flat";
  }

  if (includesAny(action, ["鐵鷹", "禿鷹", "🦅"]) || actionLower.includes("iron condor")) return "ic";
  if (includesAny(action, ["觀望", "防守", "空倉"]) || actionLower.includes("hold")) return "defense";
  if (includesAny(action, ["買入", "做多", "做空"]) || actionLower.includes("open_")) return "entry";

  return "pending";
};

export const classifyEventType = (item: ActionLogItem, status: TimelineStatus): RecapEventType => {
  const action = item.action || "";

  if (status === "ic") return "ic";
  if (status === "defense") return "defense";
  if (status === "entry") return "entry";
  if (status === "win" || status === "loss" || status === "flat" || includesAny(action, ["平倉", "撤退", "離場"])) {
    return "exit";
  }

  return "unknown";
};

export const detectPositionSide = (item: ActionLogItem, status: TimelineStatus): RecapPositionSide => {
  const action = (item.action || "").toUpperCase();
  const reasoning = (item.reasoning || "").toUpperCase();
  const haystack = `${action} ${reasoning}`;

  if (status === "ic" || haystack.includes("IRON CONDOR") || item.action?.includes("鐵鷹")) return "IC";
  if (haystack.includes("CALL")) return "CALL";
  if (haystack.includes("PUT")) return "PUT";

  return "NONE";
};

export const normalizeTimeline = (items: ActionLogItem[], selectedDate: string): TimelineItem[] => {
  const openEntries: Partial<Record<RecapPositionSide, string>> = {};

  return items.map((item, index) => {
    const ordinal = index + 1;
    const timestampDate = parseDateFromTimestamp(item.time) || selectedDate;
    const id = makeCalloutId(timestampDate, ordinal);
    const status = classifyStatus(item);
    const eventType = classifyEventType(item, status);
    const positionSide = detectPositionSide(item, status);
    let relatedEntryId: string | null = null;

    if (eventType === "entry" && positionSide !== "NONE") {
      openEntries[positionSide] = id;
    }

    if (eventType === "exit" && positionSide !== "NONE") {
      relatedEntryId = openEntries[positionSide] || null;
      delete openEntries[positionSide];
    }

    if (eventType === "ic") {
      relatedEntryId = openEntries.IC || null;
      if (includesAny(item.action || "", ["部署"])) openEntries.IC = id;
      if (includesAny(item.action || "", ["撤退", "平倉", "獲利"])) delete openEntries.IC;
    }

    return {
      id,
      date: timestampDate,
      ordinal,
      time: formatTime(item.time),
      timestamp: item.time || null,
      price: observedNumber(item.price),
      action: item.action || "未命名訊號",
      reasoning: item.reasoning || "未提供理由",
      pnl: observedNumber(item.pnl),
      status,
      eventType,
      positionSide,
      relatedEntryId,
      rawJson: JSON.stringify(item),
    };
  });
};

export const buildSummary = (timeline: TimelineItem[]): RecapSummary => {
  const wins = timeline.filter((item) => item.status === "win").length;
  const losses = timeline.filter((item) => item.status === "loss").length;
  const flatCloses = timeline.filter((item) => item.status === "flat").length;
  const closedCount = wins + losses;
  const directionalEntries = timeline.filter((item) => item.status === "entry").length;
  const pnlCloses = wins + losses + flatCloses;

  return {
    totalCallouts: timeline.length,
    tradesTaken: Math.max(directionalEntries, pnlCloses),
    wins,
    losses,
    flatCloses,
    winRate: closedCount > 0 ? Number(((wins / closedCount) * 100).toFixed(1)) : null,
    totalPnlPoints: Number(
      timeline.reduce((sum, item) => sum + (typeof item.pnl === "number" ? item.pnl : 0), 0).toFixed(2),
    ),
    defensiveHolds: timeline.filter((item) => item.status === "defense").length,
    icEvents: timeline.filter((item) => item.status === "ic").length,
  };
};

export const normalizeRecapDay = (date: string, memory: DailyMemory): NormalizedRecapDay => {
  const timeline = normalizeTimeline(Array.isArray(memory.actionLog) ? memory.actionLog : [], date);
  const summary = buildSummary(timeline);

  return {
    date,
    summary,
    timeline,
    firstCalloutAt: timeline[0]?.timestamp || null,
    lastCalloutAt: timeline[timeline.length - 1]?.timestamp || null,
  };
};

export const parseAuditPayload = (rawAudit: string | null, fallbackDate = ""): AuditPayload | null => {
  if (!rawAudit) return null;

  try {
    const parsed = JSON.parse(rawAudit);
    if (parsed && typeof parsed.report === "string") {
      const learnedRules = Array.isArray(parsed.learnedRules)
        ? parsed.learnedRules
        : Array.isArray(parsed.learned_rules)
          ? parsed.learned_rules
          : [];

      return {
        date: typeof parsed.date === "string" ? parsed.date : fallbackDate,
        generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
        report: parsed.report,
        learnedRules: learnedRules.filter((rule: unknown): rule is string => typeof rule === "string"),
        actionLogSize: Number.isFinite(Number(parsed.actionLogSize)) ? Number(parsed.actionLogSize) : null,
      };
    }
  } catch {
    // Legacy value may be plain text.
  }

  return {
    date: fallbackDate,
    generatedAt: null,
    report: rawAudit,
    learnedRules: [],
    actionLogSize: null,
  };
};

export const buildDerivedAudit = (selectedDate: string, timeline: TimelineItem[], summary: RecapSummary) => {
  const winRate = summary.winRate === null ? "N/A" : `${summary.winRate}%`;
  const best = timeline
    .filter((item) => typeof item.pnl === "number")
    .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))[0];

  const auditLines = timeline.map((item) => {
    const price = item.price === null ? "N/A" : item.price.toFixed(2);
    const pnl = item.pnl === null ? "" : ` | SPX 方向點數 ${item.pnl > 0 ? "+" : ""}${item.pnl.toFixed(2)} pts`;
    return `- ${item.time} ET: ${item.action} @ ${price}${pnl}。${item.reasoning}`;
  });

  return [
    `## 每日審計報告`,
    ``,
    `**美東日期：${selectedDate} | 標的：SPX**`,
    `依結構化 callout 記錄計算 SPX 方向點數，並非券商成交、選擇權損益或扣費後報酬。`,
    ``,
    `### 1. 戰績總覽`,
    `- 系統總播報次數：${summary.totalCallouts} 次`,
    `- Callout 交易計數：${summary.tradesTaken} 次`,
    `- 正向點數平倉：${summary.wins} 次`,
    `- 負向點數平倉：${summary.losses} 次`,
    `- 平手離場：${summary.flatCloses} 次`,
    `- 主動空倉防守：${summary.defensiveHolds} 次`,
    `- Callout 勝率（不含持平）：${winRate}`,
    `- SPX 方向累計點數：${summary.totalPnlPoints > 0 ? "+" : ""}${summary.totalPnlPoints} pts`,
    ``,
    `### 2. 最高方向點數紀錄`,
    best
      ? `- ${best.time} ET：${best.action}，SPX 方向點數 ${best.pnl && best.pnl > 0 ? "+" : ""}${best.pnl?.toFixed(2)} pts。${best.reasoning}`
      : `- N/A。今日沒有帶方向點數的平倉紀錄。`,
    ``,
    `### 3. 每日審計清單`,
    ...auditLines,
  ].join("\n");
};
