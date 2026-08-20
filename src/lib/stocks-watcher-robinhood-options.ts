import { normalizeStocksWatcherSymbol } from "./stocks-native-yahoo";

/** Immutable, EOD-only contract. It is deliberately separate from Yahoo's live options shape. */
export const ROBINHOOD_OPTIONS_SCHEMA_VERSION = "1.0";
export const ROBINHOOD_OPTIONS_PROVIDER = "robinhood_mcp" as const;
export const ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS = 50;
export const ROBINHOOD_OPTIONS_MAX_EXPIRIES = 8;
export const ROBINHOOD_OPTIONS_MAX_AGE_MS = 30 * 60 * 60 * 1000;
export const ROBINHOOD_OPTIONS_MAX_SPOT_DIVERGENCE = 0.03;

export interface RobinhoodOptionsR2Object { text: () => Promise<string>; }
export interface RobinhoodOptionsR2BucketLike { get: (key: string) => Promise<RobinhoodOptionsR2Object | null>; }

export interface RobinhoodOptionContract {
  symbol: string;
  expiry: string;
  strike: number;
  callPut: "call" | "put";
  multiplier: number;
  openInterest: number;
  gamma: number;
  impliedVolatility: number;
  delta: number;
  volume: number;
  mark: number;
  quoteUpdatedAt: string;
  spot: number;
  capturedAt: string;
}

export interface RobinhoodOptionsCurrentPointer {
  schemaVersion: string;
  provider: typeof ROBINHOOD_OPTIONS_PROVIDER;
  releaseId: string;
  runId: string;
  manifestKey: string;
  manifestSha256: string;
  capturedAt: string;
  expectedSymbols: number;
  completedSymbols: number;
}

export interface RobinhoodOptionsManifestSymbol { symbol: string; key: string; sha256: string; contracts: number; }
export interface RobinhoodOptionsManifest {
  schemaVersion: string;
  provider: typeof ROBINHOOD_OPTIONS_PROVIDER;
  releaseId: string;
  runId: string;
  capturedAt: string;
  expectedSymbols: number;
  completedSymbols: number;
  symbols: RobinhoodOptionsManifestSymbol[];
}

export interface RobinhoodOptionsSymbolSnapshot {
  schemaVersion: string;
  provider: typeof ROBINHOOD_OPTIONS_PROVIDER;
  releaseId: string;
  runId: string;
  symbol: string;
  capturedAt: string;
  spot: number;
  contracts: RobinhoodOptionContract[];
}

export interface RobinhoodOptionsPublishedSnapshot extends RobinhoodOptionsSymbolSnapshot {
  manifest: Pick<RobinhoodOptionsManifest, "expectedSymbols" | "completedSymbols"> & { key: string; sha256: string; };
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const fail = (reason: string): never => { throw new Error(`ROBINHOOD_OPTIONS_INVALID: ${reason}`); };

const assertHash = (value: string) => {
  if (!/^[a-f0-9]{64}$/i.test(value)) fail("sha256 is malformed");
  return value.toLowerCase();
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const parseTimestamp = (value: unknown, field: string) => {
  const parsed = string(value);
  const timestamp = parsed ? Date.parse(parsed) : Number.NaN;
  if (!parsed || !Number.isFinite(timestamp)) fail(`${field} is invalid`);
  if (timestamp > Date.now() + 15 * 60 * 1000) fail(`${field} is in the future`);
  return { value: parsed, timestamp };
};

const parseCurrent = (value: unknown): RobinhoodOptionsCurrentPointer => {
  const row = object(value);
  const releaseId = string(row?.releaseId);
  const runId = string(row?.runId);
  const manifestKey = string(row?.manifestKey);
  const capturedAt = parseTimestamp(row?.capturedAt, "capturedAt").value;
  const expectedSymbols = number(row?.expectedSymbols);
  const completedSymbols = number(row?.completedSymbols);
  if (!row || row.schemaVersion !== ROBINHOOD_OPTIONS_SCHEMA_VERSION || row.provider !== ROBINHOOD_OPTIONS_PROVIDER || !releaseId || !/^[A-Za-z0-9._-]+$/.test(releaseId) || !runId || !manifestKey || expectedSymbols !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS || completedSymbols !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS) fail("current pointer contract mismatch");
  const manifestSha256 = assertHash(string((row as Record<string, unknown>).manifestSha256) || "");
  return { schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION, provider: ROBINHOOD_OPTIONS_PROVIDER, releaseId: releaseId!, runId: runId!, manifestKey: manifestKey!, manifestSha256, capturedAt: capturedAt!, expectedSymbols: expectedSymbols!, completedSymbols: completedSymbols! };
};

const parseManifest = (value: unknown, current: RobinhoodOptionsCurrentPointer): RobinhoodOptionsManifest => {
  const row = object(value);
  if (!row || row.schemaVersion !== ROBINHOOD_OPTIONS_SCHEMA_VERSION || row.provider !== ROBINHOOD_OPTIONS_PROVIDER || row.releaseId !== current.releaseId || row.runId !== current.runId || row.capturedAt !== current.capturedAt || row.expectedSymbols !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS || row.completedSymbols !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS || !Array.isArray(row.symbols)) fail("manifest contract mismatch");
  const symbolRows = (row as Record<string, unknown>).symbols as unknown[];
  const symbols = symbolRows.map((entry) => {
    const item = object(entry);
    const symbol = string(item?.symbol);
    const key = string(item?.key);
    const contracts = number(item?.contracts);
    if (!symbol || !key || contracts === null || !Number.isInteger(contracts) || contracts < 1) fail("manifest symbol is malformed");
    return { symbol: normalizeStocksWatcherSymbol(symbol!), key: key!, sha256: assertHash(string(item?.sha256) || ""), contracts: contracts! };
  });
  if (symbols.length !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS || new Set(symbols.map((entry) => entry.symbol)).size !== ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS) fail("manifest must contain exactly 50 unique symbols");
  return { schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION, provider: ROBINHOOD_OPTIONS_PROVIDER, releaseId: current.releaseId, runId: current.runId, capturedAt: current.capturedAt, expectedSymbols: current.expectedSymbols, completedSymbols: current.completedSymbols, symbols };
};

const parseContract = (value: unknown, snapshot: { symbol: string; capturedAt: string; spot: number }): RobinhoodOptionContract => {
  const row = object(value);
  const expiry = string(row?.expiry);
  const callPut = row?.callPut;
  const multiplier = number(row?.multiplier);
  const openInterest = number(row?.openInterest);
  const gamma = number(row?.gamma);
  const impliedVolatility = number(row?.impliedVolatility);
  const delta = number(row?.delta);
  const volume = number(row?.volume);
  const mark = number(row?.mark);
  const strike = number(row?.strike);
  const quoteUpdatedAt = parseTimestamp(row?.quoteUpdatedAt, "quoteUpdatedAt").value;
  const spot = number(row?.spot);
  const capturedAt = string(row?.capturedAt);
  if (!row || row.symbol !== snapshot.symbol || !expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || (callPut !== "call" && callPut !== "put") || multiplier === null || multiplier <= 0 || openInterest === null || !Number.isInteger(openInterest) || openInterest < 0 || gamma === null || gamma < 0 || impliedVolatility === null || impliedVolatility < 0 || delta === null || volume === null || volume < 0 || mark === null || mark < 0 || strike === null || strike <= 0 || spot !== snapshot.spot || capturedAt !== snapshot.capturedAt) fail("contract is malformed or missing required Greeks/OI/IV");
  if (Date.parse(capturedAt!) - Date.parse(quoteUpdatedAt!) > ROBINHOOD_OPTIONS_MAX_AGE_MS) fail("quote is stale relative to the snapshot capture");
  if (Math.abs(strike! - spot!) / spot! > 0.2 + Number.EPSILON) fail("contract strike is outside the published ±20% window");
  return { symbol: snapshot.symbol, expiry: expiry!, strike: strike!, callPut: callPut as "call" | "put", multiplier: multiplier!, openInterest: openInterest!, gamma: gamma!, impliedVolatility: impliedVolatility!, delta: delta!, volume: volume!, mark: mark!, quoteUpdatedAt: quoteUpdatedAt!, spot: spot!, capturedAt: capturedAt! };
};

const parseSymbolSnapshot = (value: unknown, manifest: RobinhoodOptionsManifest, symbol: string): RobinhoodOptionsSymbolSnapshot => {
  const row = object(value);
  const spot = number(row?.spot);
  const capturedAt = string(row?.capturedAt);
  if (!row || row.schemaVersion !== ROBINHOOD_OPTIONS_SCHEMA_VERSION || row.provider !== ROBINHOOD_OPTIONS_PROVIDER || row.releaseId !== manifest.releaseId || row.runId !== manifest.runId || row.symbol !== symbol || !capturedAt || capturedAt !== manifest.capturedAt || spot === null || spot <= 0 || !Array.isArray(row.contracts)) fail("symbol snapshot contract mismatch");
  const contractRows = (row as Record<string, unknown>).contracts as unknown[];
  const contracts = contractRows.map((contract) => parseContract(contract, { symbol, capturedAt: capturedAt!, spot: spot! }));
  if (!contracts.length) fail("symbol snapshot has no contracts");
  if (new Set(contracts.map((contract) => `${contract.expiry}:${contract.strike}:${contract.callPut}`)).size !== contracts.length) fail("duplicate contracts are not allowed");
  const expiries = [...new Set(contracts.map((contract) => contract.expiry))];
  if (expiries.length < 1 || expiries.length > ROBINHOOD_OPTIONS_MAX_EXPIRIES) fail(`symbol snapshot must contain one to ${ROBINHOOD_OPTIONS_MAX_EXPIRIES} expiries`);
  return { schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION, provider: ROBINHOOD_OPTIONS_PROVIDER, releaseId: manifest.releaseId, runId: manifest.runId, symbol, capturedAt: capturedAt!, spot: spot!, contracts };
};

const loadText = async (bucket: RobinhoodOptionsR2BucketLike | undefined, key: string) => {
  if (!bucket) throw new Error("ROBINHOOD_OPTIONS_UNAVAILABLE: OPTIONS_SNAPSHOT_DATA R2 binding is not configured.");
  const value = await bucket.get(key);
  if (!value) throw new Error(`ROBINHOOD_OPTIONS_NOT_PUBLISHED: ${key} is unavailable.`);
  return value.text();
};

export const assertRobinhoodOptionsFresh = (capturedAt: string) => {
  const { timestamp } = parseTimestamp(capturedAt, "capturedAt");
  if (Date.now() - timestamp > ROBINHOOD_OPTIONS_MAX_AGE_MS) throw new Error("ROBINHOOD_OPTIONS_STALE: published EOD snapshot is older than 30 hours.");
};

export const loadRobinhoodOptionsSnapshot = async (bucket: RobinhoodOptionsR2BucketLike | undefined, symbolInput: string): Promise<RobinhoodOptionsPublishedSnapshot> => {
  const currentText = await loadText(bucket, "current.json");
  const current = parseCurrent(JSON.parse(currentText));
  assertRobinhoodOptionsFresh(current.capturedAt);
  const manifestText = await loadText(bucket, current.manifestKey);
  if (await sha256(manifestText) !== current.manifestSha256) fail("manifest sha256 mismatch");
  const manifest = parseManifest(JSON.parse(manifestText), current);
  const symbol = normalizeStocksWatcherSymbol(symbolInput);
  const entry = manifest.symbols.find((candidate) => candidate.symbol === symbol);
  if (!entry) throw new Error(`ROBINHOOD_OPTIONS_NOT_COVERED: ${symbol} is not in the validated current snapshot.`);
  const symbolText = await loadText(bucket, entry.key);
  if (await sha256(symbolText) !== entry.sha256) fail("symbol snapshot sha256 mismatch");
  const snapshot = parseSymbolSnapshot(JSON.parse(symbolText), manifest, symbol);
  if (snapshot.contracts.length !== entry.contracts) fail("manifest contract count mismatch");
  return { ...snapshot, manifest: { expectedSymbols: manifest.expectedSymbols, completedSymbols: manifest.completedSymbols, key: current.manifestKey, sha256: current.manifestSha256 } };
};

export const robinhoodGex = (contract: RobinhoodOptionContract) => contract.gamma * contract.openInterest * contract.multiplier * contract.spot ** 2 * 0.01;
export const robinhoodDex = (contract: RobinhoodOptionContract) => contract.delta * contract.openInterest * contract.multiplier * contract.spot;

export const assertRobinhoodSpotCompatible = (snapshotSpot: number, watcherSpot: number) => {
  if (!Number.isFinite(watcherSpot) || watcherSpot <= 0 || Math.abs(snapshotSpot - watcherSpot) / snapshotSpot > ROBINHOOD_OPTIONS_MAX_SPOT_DIVERGENCE) throw new Error("ROBINHOOD_OPTIONS_SPOT_MISMATCH: EOD snapshot spot is not compatible with the current quote.");
};

export const toRobinhoodOptionsView = (snapshot: RobinhoodOptionsPublishedSnapshot, requestedExpiry?: string | null) => {
  const byExpiry = new Map<string, RobinhoodOptionContract[]>();
  for (const contract of snapshot.contracts) byExpiry.set(contract.expiry, [...(byExpiry.get(contract.expiry) || []), contract]);
  const expiries = [...byExpiry.keys()].sort();
  const expiryRows = expiries.map((expiry) => {
    const contracts = byExpiry.get(expiry)!;
    const callOi = contracts.filter((row) => row.callPut === "call").reduce((sum, row) => sum + row.openInterest, 0);
    const putOi = contracts.filter((row) => row.callPut === "put").reduce((sum, row) => sum + row.openInterest, 0);
    const callVolume = contracts.filter((row) => row.callPut === "call").reduce((sum, row) => sum + row.volume, 0);
    const putVolume = contracts.filter((row) => row.callPut === "put").reduce((sum, row) => sum + row.volume, 0);
    const primary = contracts.reduce((best, row) => row.openInterest > best.openInterest ? row : best, contracts[0]);
    return { expiry, openInterest: callOi + putOi, primaryStrike: primary.strike, strike: primary.strike, volume: callVolume + putVolume, dominantType: callOi >= putOi ? "C" as const : "P" as const, type: callOi >= putOi ? "C" as const : "P" as const };
  });
  const selectedExpiry = requestedExpiry && byExpiry.has(requestedExpiry) ? requestedExpiry : expiries[0] || null;
  const selected = selectedExpiry ? byExpiry.get(selectedExpiry)! : [];
  const byStrike = new Map<number, RobinhoodOptionContract[]>();
  for (const contract of selected) byStrike.set(contract.strike, [...(byStrike.get(contract.strike) || []), contract]);
  const strikes = [...byStrike.entries()].sort(([left], [right]) => left - right).map(([strike, contracts]) => {
    const calls = contracts.filter((row) => row.callPut === "call");
    const puts = contracts.filter((row) => row.callPut === "put");
    const callGex = calls.reduce((sum, row) => sum + robinhoodGex(row), 0);
    const putGex = puts.reduce((sum, row) => sum - robinhoodGex(row), 0);
    const callDex = calls.reduce((sum, row) => sum + robinhoodDex(row), 0);
    const putDex = puts.reduce((sum, row) => sum + robinhoodDex(row), 0);
    const callOpenInterest = calls.reduce((sum, row) => sum + row.openInterest, 0);
    const putOpenInterest = puts.reduce((sum, row) => sum + row.openInterest, 0);
    const weightedIv = (rows: RobinhoodOptionContract[], totalOpenInterest: number) => rows.length === 0
      ? null
      : totalOpenInterest > 0
        ? rows.reduce((sum, row) => sum + row.impliedVolatility * row.openInterest, 0) / totalOpenInterest
        : rows.reduce((sum, row) => sum + row.impliedVolatility, 0) / rows.length;
    const callIvRaw = weightedIv(calls, callOpenInterest);
    const putIvRaw = weightedIv(puts, putOpenInterest);
    const ivValues = [callIvRaw, putIvRaw].filter((value): value is number => value !== null);
    const callIv = callIvRaw === null ? null : callIvRaw * 100;
    const putIv = putIvRaw === null ? null : putIvRaw * 100;
    return {
      strike,
      callOpenInterest,
      putOpenInterest,
      callVolume: calls.reduce((sum, row) => sum + row.volume, 0),
      putVolume: puts.reduce((sum, row) => sum + row.volume, 0),
      callGex,
      putGex,
      netGex: callGex + putGex,
      callDex,
      putDex,
      netDex: callDex + putDex,
      callIv,
      putIv,
      avgIv: ivValues.length ? (ivValues.reduce((sum, value) => sum + value, 0) / ivValues.length) * 100 : null,
      openInterestSource: "robinhood_mcp" as const,
    };
  });
  return { availableExpiries: expiries, selectedExpiry, expiryRows, strikes, selectedContracts: selected };
};

export const toRobinhoodOptionsToolPayload = (
  snapshot: RobinhoodOptionsPublishedSnapshot,
  tool: string,
  params: Record<string, unknown>,
): { text: string; raw: Record<string, unknown> } => {
  const requestedExpiry = typeof params.expiry === "string" ? params.expiry : null;
  const view = toRobinhoodOptionsView(snapshot, requestedExpiry);
  const provenance = {
    provider: ROBINHOOD_OPTIONS_PROVIDER,
    runId: snapshot.runId,
    capturedAt: snapshot.capturedAt,
    methodology: "OI-signed GEX proxy",
  };
  const chain = {
    source: ROBINHOOD_OPTIONS_PROVIDER,
    spot: snapshot.spot,
    selectedExpiry: view.selectedExpiry,
    expiries: view.availableExpiries,
    calls: view.selectedContracts.filter((row) => row.callPut === "call").map((row) => ({ ...row, type: "C" as const, lastPrice: row.mark })),
    puts: view.selectedContracts.filter((row) => row.callPut === "put").map((row) => ({ ...row, type: "P" as const, lastPrice: row.mark })),
  };
  const baseText = `${snapshot.symbol} Robinhood MCP EOD options snapshot as of ${snapshot.capturedAt}.`;
  const visualRaw = (extra: Record<string, unknown>, methodology = provenance.methodology) => ({
    source: ROBINHOOD_OPTIONS_PROVIDER,
    supported: true,
    ...extra,
    provenance: { ...provenance, methodology },
  });
  const unsupported = (reason: string) => ({
    text: `${baseText} ${reason}`,
    raw: visualRaw({ supported: false, unavailableReason: reason }),
  });

  if (tool === "get_options") {
    return { text: `${baseText} Structured chain for ${view.selectedExpiry || "unavailable expiry"}.`, raw: visualRaw({ chain }) };
  }
  if (tool === "get_options_gex" || tool === "chart_gex") {
    return {
      text: `${baseText} GEX is an OI-signed proxy, not dealer GEX.`,
      raw: visualRaw({ chain, exposures: view.strikes, chart: "net_gex_by_strike" }),
    };
  }
  if (tool === "get_options_dex" || tool === "chart_dex") {
    return {
      text: `${baseText} DEX is an OI-weighted delta exposure proxy, not dealer positioning.`,
      raw: visualRaw({ chain, exposures: view.strikes, chart: "net_dex_by_strike" }, "OI-weighted DEX proxy"),
    };
  }
  if (tool === "get_options_greeks" || tool === "chart_greeks") {
    return {
      text: `${baseText} EOD Greeks and OI-derived exposures by strike.`,
      raw: visualRaw({ chain, rows: view.strikes, contracts: view.selectedContracts, chart: "greeks_by_strike" }, "Robinhood MCP EOD Greeks"),
    };
  }
  if (tool === "get_options_iv_intraday") {
    return {
      text: `${baseText} EOD IV smile by strike; intraday history is not present in this snapshot.`,
      raw: visualRaw({ chain, rows: view.strikes, metric: "eod_iv_smile", timeSeries: false }, "Robinhood MCP EOD IV smile"),
    };
  }
  if (tool === "get_options_pcr") {
    const callOi = view.selectedContracts.filter((row) => row.callPut === "call").reduce((sum, row) => sum + row.openInterest, 0);
    const putOi = view.selectedContracts.filter((row) => row.callPut === "put").reduce((sum, row) => sum + row.openInterest, 0);
    const callVol = view.selectedContracts.filter((row) => row.callPut === "call").reduce((sum, row) => sum + row.volume, 0);
    const putVol = view.selectedContracts.filter((row) => row.callPut === "put").reduce((sum, row) => sum + row.volume, 0);
    return {
      text: `${baseText} Put/call ratios for ${view.selectedExpiry || "unavailable expiry"}.`,
      raw: visualRaw({
        expiry: view.selectedExpiry,
        putCallOpenInterest: putOi / Math.max(1, callOi),
        putCallVolume: putVol / Math.max(1, callVol),
        callOi,
        putOi,
        callVol,
        putVol,
      }, "Robinhood MCP EOD put/call ratios"),
    };
  }
  if (tool === "get_options_flow_universe") return unsupported("Robinhood EOD snapshots do not contain tape-level options flow.");
  if (tool === "get_options_sweeps") return unsupported("Robinhood EOD snapshots do not support verified sweep detection.");
  if (tool === "get_options_mispricing") return unsupported("Robinhood EOD snapshots do not contain bid/ask fields required for a mispricing scan.");
  if (tool === "get_options_0dte") {
    const capturedEtDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(snapshot.capturedAt));
    if (view.selectedExpiry !== capturedEtDate) return unsupported(`The selected expiry ${view.selectedExpiry || "is unavailable"} is not 0DTE for the snapshot date ${capturedEtDate}.`);
    return {
      text: `${baseText} 0DTE OI-derived exposure snapshot.`,
      raw: visualRaw({ chain, rows: view.strikes, metric: "0dte_exposure" }),
    };
  }
  return unsupported(`Robinhood EOD snapshots do not support ${tool}.`);
};
