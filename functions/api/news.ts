export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol");

  if (!symbol) {
    return new Response(JSON.stringify({ error: "No symbol provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const fetchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=6`;
    const res = await fetch(fetchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!res.ok) {
      throw new Error(`Yahoo returned ${res.status}`);
    }

    const data = await res.json();
    const rawNews = data.news || [];
    
    const formattedNews = rawNews.map((item: any) => ({
      title: item.title,
      source: item.publisher,
      link: item.link
    }));

    return new Response(JSON.stringify({ news: formattedNews }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
