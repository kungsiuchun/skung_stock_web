import { runPublicReport, readResearchBody, researchJson, type ResearchEnv } from "./research/report";
import { PublicResearchLimitError } from "../../src/lib/public-research-budget";
export async function onRequestPost({ request, env }: { request: Request; env: ResearchEnv }) {
  try {
    const body = await readResearchBody(request);
    const report = await runPublicReport(request, env, { symbol: body.ticker, lens: body.agentProfile === "buffett" ? "quality" : body.agentProfile === "serenity" ? "risk" : "swing", language: body.language });
    return researchJson({ success: true, report: report.content, analysis: report.content, ...report, agentProfile: body.agentProfile || "finrobot", steps: [] });
  } catch (error) { return researchJson({ success: false, error: error instanceof Error ? error.message : "Report unavailable." }, error instanceof PublicResearchLimitError ? error.status : 502); }
}
