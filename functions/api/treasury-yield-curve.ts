import {
  buildTreasuryYieldCurveResponseFromXml,
  getTreasuryYieldCurveXmlUrl,
  TreasuryYieldCurveError,
} from "../../src/lib/treasury-yield-curve";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...(init.headers || {}),
    },
  });

export async function onRequest() {
  const fetchedAt = new Date().toISOString();
  const currentYear = new Date().getUTCFullYear();
  const sourceUrl = getTreasuryYieldCurveXmlUrl(currentYear);

  try {
    const fetchYear = async (year: number) => {
      const url = getTreasuryYieldCurveXmlUrl(year);
      const response = await fetch(url, { headers: { "User-Agent": "SIU-Fixed-Income/1.0", Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" } });
      if (!response.ok) throw new TreasuryYieldCurveError(`Treasury XML source for ${year} returned HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("xml")) throw new TreasuryYieldCurveError(`Treasury XML source for ${year} returned ${contentType || "unknown content type"}.`);
      return response.text();
    };

    const xmlDocuments = await Promise.all([fetchYear(currentYear - 1), fetchYear(currentYear)]);
    return json(buildTreasuryYieldCurveResponseFromXml(xmlDocuments, fetchedAt, sourceUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      {
        error: `Treasury yield curve source failed: ${message}`,
        sourceUrl,
        fetchedAt,
      },
      { status: 502 },
    );
  }
}
