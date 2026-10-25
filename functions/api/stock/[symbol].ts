import { runPublicReport, researchJson, type ResearchEnv } from "../research/report";
import { PublicResearchLimitError } from "../../../src/lib/public-research-budget";
export async function onRequestGet({ request, env, params }: { request: Request; env: ResearchEnv; params: { symbol?: string } }) {
  try {
    const report = await runPublicReport(request, env, { symbol: params.symbol });
    return researchJson({ success: true, symbol: report.symbol, analysis: report.content, steps: [], report });
  } catch (error) { return researchJson({ success: false, error: error instanceof Error ? error.message : "Report unavailable." }, error instanceof PublicResearchLimitError ? error.status : 502); }
}
