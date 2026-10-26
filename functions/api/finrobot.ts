import { runPublicReport, runPublicThemeReport, readResearchBody, researchJson, type ResearchEnv } from "./research/report";
import { PublicResearchLimitError } from "../../src/lib/public-research-budget";
export async function onRequestPost({ request, env }: { request: Request; env: ResearchEnv }) {
  try {
    const body = await readResearchBody(request);
    const target = typeof body.ticker === "string" ? body.ticker.trim() : "";
    let report;
    if (body.agentProfile === "serenity") {
      try {
        report = await runPublicReport(request, env, { symbol: target, lens: "risk", language: body.language });
      } catch (error) {
        if (!(error instanceof PublicResearchLimitError) || error.status !== 400) throw error;
        report = await runPublicThemeReport(request, env, { target, language: body.language });
      }
    } else {
      report = await runPublicReport(request, env, { symbol: target, lens: body.agentProfile === "buffett" ? "quality" : "swing", language: body.language });
    }
    return researchJson({ success: true, report: report.content, analysis: report.content, ...report, agentProfile: body.agentProfile || "finrobot", steps: [] });
  } catch (error) { return researchJson({ success: false, error: error instanceof Error ? error.message : "Report unavailable." }, error instanceof PublicResearchLimitError ? error.status : 502); }
}
