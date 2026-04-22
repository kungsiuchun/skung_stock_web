export async function onRequest(context: any) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/^VIX?interval=1d&range=30d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error("No VIX data");

    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    
    // Filter out null values
    const validCloses = closes.filter((c: any) => c !== null);
    if (validCloses.length < 2) throw new Error("Not enough data to calculate change");

    const currentValue = validCloses[validCloses.length - 1];
    const prevValue = validCloses[validCloses.length - 2];

    const changePct = ((currentValue - prevValue) / prevValue) * 100;
    
    return new Response(JSON.stringify({ 
      value: Number(currentValue.toFixed(2)),
      change_pct: Number(changePct.toFixed(2)),
      history: validCloses.slice(-30).map((c: any) => Number(c.toFixed(2)))
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
