import { ToolDefinition } from "../types";

export async function handleSearchFredSeries(args: any, env: any) {
  try {
    const search_text = args.search_text;
    if (!search_text) return { error: "Missing search_text parameter" };
    
    const apiKey = env.FRED_API_KEY;
    if (!apiKey) return { error: "FRED_API_KEY environment variable is not configured." };

    const url = `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(search_text)}&api_key=${apiKey}&file_type=json&limit=5`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    
    if (!res.ok) throw new Error(`FRED API Search returned ${res.status}`);
    
    const data: any = await res.json();
    if (!data.seriess || data.seriess.length === 0) {
      return { result: "No series found matching query." };
    }

    const results = data.seriess.map((s: any) => ({
      id: s.id,
      title: s.title,
      frequency: s.frequency_short,
      units: s.units_short,
      popularity: s.popularity
    }));

    // In typescript map-reduce agent framework, we must simply return the json object, the orchestrator stringifies it
    return { results };
  } catch (error: any) {
    return { error: `Failed to search FRED: ${error.message}` };
  }
}

export async function handleGetFredSeries(args: any, env: any) {
  try {
    const series_id = args.series_id;
    const limit = args.limit || 12;
    if (!series_id) return { error: "Missing series_id parameter" };
    
    const apiKey = env.FRED_API_KEY;
    if (!apiKey) return { error: "FRED_API_KEY environment variable is not configured." };

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series_id)}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    
    if (!res.ok) {
        if (res.status === 400) return { error: `Series ID '${series_id}' is invalid or API key has insufficient permissions.`};
        throw new Error(`FRED API Observations returned ${res.status}`);
    }
    
    const data: any = await res.json();
    if (!data.observations || data.observations.length === 0) {
      return { result: "No observation data found for the requested series." };
    }

    const observations = data.observations.map((obs: any) => ({
      date: obs.date,
      value: obs.value
    }));

    return { 
      series_id,
      count: observations.length,
      observations 
    };
  } catch (error: any) {
    return { error: `Failed to get FRED series data: ${error.message}` };
  }
}

export const macroTools: ToolDefinition[] = [
  {
    name: "search_fred_series",
    description: "Search for Federal Reserve Economic Data (FRED) series IDs using a keyword. Useful for finding the exact string identifier needed for get_fred_series.",
    parameters: [
      {
        name: "search_text",
        type: "string",
        description: "Search query, e.g., 'Unemployment', 'GDP', 'Inflation'."
      }
    ],
    handler: handleSearchFredSeries,
    category: "macro"
  },
  {
    name: "get_fred_series",
    description: "Get historical observations for a specific FRED series (e.g. UNRATE for unemployment, GDP, CPIAUCSL for inflation).",
    parameters: [
      {
        name: "series_id",
        type: "string",
        description: "The unique series ID on FRED, e.g. 'UNRATE', 'GDP'."
      },
      {
        name: "limit",
        type: "string",
        description: "Number of most recent observations to fetch. Default is 12 (optional)."
      }
    ],
    handler: handleGetFredSeries,
    category: "macro"
  }
];
