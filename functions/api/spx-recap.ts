import {
  listD1AvailableDates,
  readD1Analytics,
  readD1RecapDay,
  type D1DatabaseLike,
} from "../../src/lib/spx-recap-d1";
import {
  type AuditPayload,
  type DailyMemory,
  buildDerivedAudit,
  emptySummary,
  isValidDate,
  normalizeRecapDay,
  parseAuditPayload,
  toDateKey,
} from "../../src/lib/spx-recap-normalizer";

interface KVNamespaceLike {
  get: (key: string) => Promise<string | null>;
  list: (options?: { prefix?: string; cursor?: string; limit?: number }) => Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

interface Env {
  SPX_MEMORY?: KVNamespaceLike;
  SPX_RECAP_DB?: D1DatabaseLike;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30",
      ...(init.headers || {}),
    },
  });

const uniqueSortedDesc = (dates: string[]) =>
  Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))).sort().reverse();

async function listKVDates(env: Env) {
  if (!env.SPX_MEMORY) return [];

  const names: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await env.SPX_MEMORY.list({ prefix: "spx_memory_", cursor, limit: 1000 });
    names.push(...result.keys.map((key) => key.name));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return uniqueSortedDesc(names.map(toDateKey));
}

async function readKVAudit(env: Env, date: string): Promise<AuditPayload | null> {
  if (!env.SPX_MEMORY) return null;
  const rawAudit = await env.SPX_MEMORY.get(`spx_audit_${date}`);
  return parseAuditPayload(rawAudit, date);
}

async function readKVRecap(env: Env, selectedDate: string) {
  if (!env.SPX_MEMORY) return null;
  const rawMemory = await env.SPX_MEMORY.get(`spx_memory_${selectedDate}`);
  const memory: DailyMemory = rawMemory ? JSON.parse(rawMemory) : { actionLog: [] };
  const normalized = normalizeRecapDay(selectedDate, memory);
  const audit = await readKVAudit(env, selectedDate);

  return {
    day: normalized,
    audit,
  };
}

async function readKVRules(env: Env) {
  if (!env.SPX_MEMORY) return [];

  try {
    const raw = await env.SPX_MEMORY.get("SPX_WISDOM_BOOK");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((rule: unknown): rule is string => typeof rule === "string").map((text) => ({ sourceDate: null, text }))
      : [];
  } catch {
    return [];
  }
}

async function buildKVAnalytics(env: Env, dates: string[], fromDate: string, toDate: string) {
  const rangeDates = dates.filter((date) => date >= fromDate && date <= toDate).sort();
  const days = [];

  for (const date of rangeDates) {
    const recap = await readKVRecap(env, date);
    if (!recap) continue;
    days.push({
      date,
      ...recap.day.summary,
      firstCalloutAt: recap.day.firstCalloutAt,
      lastCalloutAt: recap.day.lastCalloutAt,
    });
  }

  const wins = days.reduce((sum, day) => sum + day.wins, 0);
  const losses = days.reduce((sum, day) => sum + day.losses, 0);

  return {
    days,
    summary: {
      totalCallouts: days.reduce((sum, day) => sum + day.totalCallouts, 0),
      tradesTaken: days.reduce((sum, day) => sum + day.tradesTaken, 0),
      wins,
      losses,
      flatCloses: days.reduce((sum, day) => sum + day.flatCloses, 0),
      winRate: wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null,
      totalPnlPoints: Number(days.reduce((sum, day) => sum + day.totalPnlPoints, 0).toFixed(2)),
      defensiveHolds: days.reduce((sum, day) => sum + day.defensiveHolds, 0),
      icEvents: days.reduce((sum, day) => sum + day.icEvents, 0),
    },
    learnedRules: await readKVRules(env),
  };
}

const chooseSelectedDate = (availableDates: string[], requestedDate: string | null) => {
  if (isValidDate(requestedDate) && availableDates.includes(requestedDate!)) return requestedDate!;
  return availableDates[0] || null;
};

const resolveRange = (url: URL, availableDates: string[], selectedDate: string | null) => {
  if (availableDates.length === 0) return { fromDate: null, toDate: null };

  const requestedFrom = url.searchParams.get("from");
  const requestedTo = url.searchParams.get("to");
  const sortedAsc = [...availableDates].sort();
  const defaultEnd = selectedDate || availableDates[0];
  const defaultEndIndex = sortedAsc.indexOf(defaultEnd);
  const defaultWindow = defaultEndIndex >= 0
    ? sortedAsc.slice(Math.max(0, defaultEndIndex - 9), defaultEndIndex + 1)
    : sortedAsc.slice(-10);

  const fromDate = isValidDate(requestedFrom) ? requestedFrom! : defaultWindow[0];
  const toDate = isValidDate(requestedTo) ? requestedTo! : defaultWindow[defaultWindow.length - 1];

  return fromDate <= toDate ? { fromDate, toDate } : { fromDate: toDate, toDate: fromDate };
};

export async function onRequest(context: { request: Request; env: Env }) {
  const url = new URL(context.request.url);
  const warnings: string[] = [];
  let source: "d1" | "kv" | "empty" = "empty";
  let d1Dates: string[] = [];
  let kvDates: string[] = [];

  if (context.env.SPX_RECAP_DB) {
    try {
      d1Dates = await listD1AvailableDates(context.env.SPX_RECAP_DB);
    } catch (error) {
      warnings.push(`D1 unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push("SPX_RECAP_DB binding is not configured; using KV fallback.");
  }

  if (context.env.SPX_MEMORY) {
    try {
      kvDates = await listKVDates(context.env);
    } catch (error) {
      warnings.push(`KV date list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push("SPX_MEMORY binding is not configured.");
  }

  const availableDates = uniqueSortedDesc([...d1Dates, ...kvDates]);
  const selectedDate = chooseSelectedDate(availableDates, url.searchParams.get("date"));
  const { fromDate, toDate } = resolveRange(url, availableDates, selectedDate);

  if (!selectedDate) {
    return json({
      availableDates: [],
      selectedDate: null,
      summary: emptySummary,
      timeline: [],
      auditReport: "## 每日審計報告\n\n未找到 SPX recap 資料。D1/KV binding 或資料源未就緒。",
      source,
      warnings,
      analytics: { days: [], summary: emptySummary, learnedRules: [] },
      auditMeta: null,
    });
  }

  let recap = null;

  if (context.env.SPX_RECAP_DB && d1Dates.includes(selectedDate)) {
    try {
      recap = await readD1RecapDay(context.env.SPX_RECAP_DB, selectedDate);
      if (recap) source = "d1";
    } catch (error) {
      warnings.push(`D1 read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!recap) {
    recap = await readKVRecap(context.env, selectedDate);
    source = recap ? "kv" : "empty";
  }

  if (!recap) {
    return json({
      availableDates,
      selectedDate,
      summary: emptySummary,
      timeline: [],
      auditReport: "## 每日審計報告\n\n此日期沒有可讀取的 recap data。",
      source,
      warnings,
      analytics: { days: [], summary: emptySummary, learnedRules: [] },
      auditMeta: null,
    });
  }

  let audit = recap.audit;
  if (!audit && source === "d1") {
    audit = await readKVAudit(context.env, selectedDate);
  }

  let analytics = { days: [], summary: emptySummary, learnedRules: [] as { sourceDate: string | null; text: string }[] };
  if (fromDate && toDate) {
    if (context.env.SPX_RECAP_DB && d1Dates.length > 0) {
      try {
        analytics = await readD1Analytics(context.env.SPX_RECAP_DB, fromDate, toDate);
      } catch (error) {
        warnings.push(`D1 analytics failed: ${error instanceof Error ? error.message : String(error)}`);
        analytics = await buildKVAnalytics(context.env, availableDates, fromDate, toDate);
      }
    } else {
      analytics = await buildKVAnalytics(context.env, availableDates, fromDate, toDate);
    }

    if (analytics.learnedRules.length === 0) {
      analytics = {
        ...analytics,
        learnedRules: await readKVRules(context.env),
      };
    }
  }

  const auditReport = audit?.report || buildDerivedAudit(selectedDate, recap.day.timeline, recap.day.summary);

  return json({
    availableDates,
    selectedDate,
    summary: recap.day.summary,
    timeline: recap.day.timeline,
    auditReport,
    source,
    warnings,
    analytics,
    auditMeta: audit
      ? {
          generatedAt: audit.generatedAt,
          actionLogSize: audit.actionLogSize,
          learnedRules: audit.learnedRules,
        }
      : null,
  });
}
