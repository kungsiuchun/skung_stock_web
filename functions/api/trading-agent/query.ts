import { runPublicReport, readResearchBody, researchJson, type ResearchEnv } from "../research/report";
import { PublicResearchLimitError } from "../../../src/lib/public-research-budget";
export async function onRequestPost({ request, env }: { request: Request; env: ResearchEnv }) {
  try {
    const body = await readResearchBody(request);
    const report = await runPublicReport(request, env, { symbol: body.stock_code, language: body.language });
    return researchJson({ success: true, results: { success: true, stock_code: report.symbol, manager: { report: report.content }, report: report.content, analysts: [], ...report } });
  } catch (error) { return researchJson({ success: false, error: error instanceof Error ? error.message : "Report unavailable." }, error instanceof PublicResearchLimitError ? error.status : 502); }
}
