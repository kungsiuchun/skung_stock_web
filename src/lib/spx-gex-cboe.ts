import type { SpxGexDataClient, SpxGexMarketContext, SpxGexOptionChain, SpxGexOptionLeg } from "./spx-gex-heatmap";
import { NativeSpxGexYahooClient } from "./stocks-native-yahoo";

const CBOE_SPX_OPTIONS_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";
const CBOE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MARKET_TIME_ZONE = "America/New_York";

type OptionSide = "C" | "P";
type FetchJson = () => Promise<unknown>;

const CBOE_FETCH_TIMEOUT_MS = 12_000;
const CBOE_FETCH_ATTEMPTS = 2;

export interface ParsedCboeOptionSymbol {
  root: string;
  expiry: string;
  side: OptionSide;
  strike: number;
}

interface CboeNormalizedLeg extends SpxGexOptionLeg {
  expiry: string;
  side: OptionSide;
}

export const parseCboeOptionSymbol = (symbol: string): ParsedCboeOptionSymbol | null => {
  const match = symbol.match(/^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, root, yy, mm, dd, side, strikeRaw] = match;
  const strike = Number(strikeRaw) / 1000;
  if (!Number.isFinite(strike)) return null;
  return {
    root,
    expiry: `${2000 + Number(yy)}-${mm}-${dd}`,
    side: side as OptionSide,
    strike,
  };
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? value as Record<string, any> : {};

const toOptionalNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + 1e-9) * factor) / factor;
};

const roundOptional = (value: unknown, digits = 2) => {
  const number = toOptionalNumber(value);
  return number === null ? null : roundTo(number, digits);
};

const roundOptionalInteger = (value: unknown) => {
  const number = toOptionalNumber(value);
  return number === null ? null : Math.round(number);
};

const normalizeCboeIv = (value: unknown) => {
  const number = toOptionalNumber(value);
  if (number === null) return null;
  return number <= 3 ? roundTo(number * 100, 2) : roundTo(number, 2);
};

const todayEt = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const normalizeCboeLeg = (row: Record<string, any>): CboeNormalizedLeg | null => {
  const option = String(row.option || "");
  const parsed = parseCboeOptionSymbol(option);
  if (!parsed || !["SPX", "SPXW"].includes(parsed.root)) return null;
  return {
    contractSymbol: option,
    expiry: parsed.expiry,
    side: parsed.side,
    strike: parsed.strike,
    lastPrice: roundOptional(row.last_trade_price),
    bid: roundOptional(row.bid),
    ask: roundOptional(row.ask),
    volume: roundOptionalInteger(row.volume),
    openInterest: roundOptionalInteger(row.open_interest),
    impliedVolatility: normalizeCboeIv(row.iv),
  };
};

export const parseCboeSpxOptionsPayload = (
  payload: unknown,
  options: { todayEt?: string } = {},
): SpxGexOptionChain[] => {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rawOptions = Array.isArray(data.options) ? data.options.map(asRecord) : [];
  const legs = rawOptions.map(normalizeCboeLeg).filter((leg): leg is CboeNormalizedLeg => Boolean(leg));
  const allExpiries = Array.from(new Set(legs.map((leg) => leg.expiry))).sort();
  const today = options.todayEt;
  const firstEligibleExpiry = today
    ? allExpiries.find((expiry) => expiry >= today)
    : allExpiries[0];
  const expiries = firstEligibleExpiry
    ? allExpiries.filter((expiry) => expiry >= firstEligibleExpiry)
    : allExpiries;
  const spot = roundOptional(data.current_price) ?? roundOptional(data.price) ?? 0;
  const source = {
    provider: "cboe",
    label: "Cboe delayed",
    timestamp: typeof root.timestamp === "string" ? root.timestamp : null,
    url: CBOE_SPX_OPTIONS_URL,
  };

  return expiries.map((expiry) => {
    const expiryLegs = legs.filter((leg) => leg.expiry === expiry);
    return {
      symbol: "SPX",
      spot,
      expiries,
      selectedExpiry: expiry,
      calls: expiryLegs.filter((leg) => leg.side === "C"),
      puts: expiryLegs.filter((leg) => leg.side === "P"),
      source,
    };
  });
};

const fetchCboeJson = async () => {
  const errors: string[] = [];

  for (let attempt = 1; attempt <= CBOE_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CBOE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(CBOE_SPX_OPTIONS_URL, {
        headers: {
          "User-Agent": CBOE_USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      }

      return await response.json() as unknown;
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`attempt ${attempt}: ${message}`);
    }
  }

  throw new Error(`Cboe delayed options request failed after ${CBOE_FETCH_ATTEMPTS} attempts: ${errors.join(" | ")}`);
};

export class CboeSpxGexDataClient implements SpxGexDataClient {
  private readonly fetchJson: FetchJson;
  private readonly now: () => Date;
  private chainsPromise: Promise<SpxGexOptionChain[]> | null = null;

  constructor(options: { fetchJson?: FetchJson; now?: () => Date } = {}) {
    this.fetchJson = options.fetchJson || fetchCboeJson;
    this.now = options.now || (() => new Date());
  }

  private async chains() {
    if (!this.chainsPromise) {
      this.chainsPromise = this.fetchJson().then((payload) =>
        parseCboeSpxOptionsPayload(payload, { todayEt: todayEt(this.now()) }),
      );
    }
    const chains = await this.chainsPromise;
    if (chains.length === 0) throw new Error("Cboe delayed options returned no active SPX expiries.");
    return chains;
  }

  async getQuotes() {
    const chain = await this.getOptionsChain();
    return [
      "| Ticker | Last | Change | Change % |",
      "| --- | ---: | ---: | ---: |",
      `| SPX | $${chain.spot.toFixed(2)} | n/a | n/a |`,
    ].join("\n");
  }

  async getOptions() {
    const chains = await this.chains();
    return `**Available expiries:** ${chains[0]?.expiries.join(", ") || "none"}`;
  }

  async getOptions0Dte() {
    const chain = await this.getOptionsChain();
    return `**Snapshot:** ${chain.source?.timestamp || new Date().toISOString()} **Session phase:** \`cboe_delayed\`\n**Expiry:** ${chain.selectedExpiry || "none"}`;
  }

  async getOptionsGex(expiry: string) {
    const chain = await this.getOptionsChain(expiry);
    return `**Snapshot:** ${chain.source?.timestamp || new Date().toISOString()} **Spot:** $${chain.spot.toFixed(2)}\n| Strike | Call OI | Put OI |\n| ---: | ---: | ---: |\n${chain.calls.map((call) => {
      const put = chain.puts.find((leg) => leg.strike === call.strike);
      return `| $${call.strike.toFixed(0)} | ${call.openInterest ?? "n/a"} | ${put?.openInterest ?? "n/a"} |`;
    }).join("\n")}`;
  }

  async getOptionsChain(expiry?: string): Promise<SpxGexOptionChain> {
    const chains = await this.chains();
    const selectedExpiry = expiry || chains[0]?.selectedExpiry;
    const chain = chains.find((item) => item.selectedExpiry === selectedExpiry);
    if (!chain) throw new Error(`Cboe delayed options returned no SPX chain for ${selectedExpiry || "front expiry"}.`);
    return chain;
  }
}

export class FallbackSpxGexDataClient implements SpxGexDataClient {
  private readonly primary: SpxGexDataClient;
  private readonly fallback: SpxGexDataClient;
  private selectedClientPromise: Promise<SpxGexDataClient> | null = null;

  constructor(options: { primary: SpxGexDataClient; fallback: SpxGexDataClient }) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  private async selectedClient() {
    if (!this.selectedClientPromise) {
      this.selectedClientPromise = (async () => {
        if (!this.primary.getOptionsChain) return this.fallback;
        try {
          await this.primary.getOptionsChain();
          return this.primary;
        } catch {
          return this.fallback;
        }
      })();
    }
    return this.selectedClientPromise;
  }

  async getQuotes() {
    return (await this.selectedClient()).getQuotes();
  }

  async getOptions() {
    return (await this.selectedClient()).getOptions();
  }

  async getOptions0Dte() {
    return (await this.selectedClient()).getOptions0Dte();
  }

  async getOptionsGex(expiry: string) {
    return (await this.selectedClient()).getOptionsGex(expiry);
  }

  async getOptionsChain(expiry?: string) {
    const client = await this.selectedClient();
    if (!client.getOptionsChain) throw new Error("Selected SPX GEX data client does not support structured option chains.");
    const chain = await client.getOptionsChain(expiry);
    if (client === this.fallback && chain.source) {
      return {
        ...chain,
        source: {
          ...chain.source,
          label: chain.source.label.includes("fallback") ? chain.source.label : `${chain.source.label} fallback`,
          fallbackFrom: "Cboe delayed",
        },
      };
    }
    return chain;
  }

  async getMarketContext(): Promise<SpxGexMarketContext> {
    const client = await this.selectedClient();
    if (client === this.fallback && this.fallback.getMarketContext) return this.fallback.getMarketContext();

    return {
      macroRegime: null,
      breadth: null,
      flow: null,
      latestHeadline: null,
      warnings: ["Cboe delayed source selected; Yahoo market context skipped to keep heatmap generation independent of Yahoo crumb/4xx failures."],
    };
  }
}

export const createSpxGexIntradayDataClient = () =>
  new FallbackSpxGexDataClient({
    primary: new CboeSpxGexDataClient(),
    fallback: new NativeSpxGexYahooClient(),
  });
