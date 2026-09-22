import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { profile } from "@/config/profile";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const resumeLines = [
  "$ siu resume --build",
  `> ${profile.name}`,
  "> Data Analyst / Canvas Worldwide",
  "> 4+ years / marketing analytics",
  "> SQL · Python · Power BI · Tableau",
  "> Marketing analytics + KPI automation",
  "> Market research tools + ETF backtesting",
  "> Computer Science / SFSU",
  "> Fabric + Power BI certifications",
  "> Ready. Explore the full résumé below.",
];
const fullText = resumeLines.join("\n");

export function AboutResumeTerminal() {
  const reducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const complete = reducedMotion || progress >= 100;
  useEffect(() => {
    if (reducedMotion || paused || complete) return;
    const timer = window.setInterval(
      () => setProgress((value) => Math.min(100, value + 2)),
      80,
    );
    return () => window.clearInterval(timer);
  }, [reducedMotion, paused, complete]);
  return (
    <section className="resume-terminal" aria-label="Animated résumé terminal">
      <div className="terminal-titlebar">
        <span className="terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>resume-build.exe</span>
      </div>
      <div className="terminal-body">
        <p>SIU / THE PERSON BEHIND THE WORK</p>
        <pre aria-hidden="true">
          {complete
            ? fullText
            : fullText.slice(0, Math.floor((fullText.length * progress) / 100))}
          {complete ? "" : "▌"}
        </pre>
        <p className="sr-only">
          Animated presentation of Siu’s profile. All professional information
          is also available as readable text on this page and in the résumé PDF.
        </p>
        <div className="terminal-progress" aria-hidden="true">
          <span style={{ width: `${complete ? 100 : progress}%` }} />
        </div>
        <p className="terminal-status">
          {complete
            ? "PROFILE READY / 100%"
            : paused
              ? "PAUSED"
              : `BUILDING PROFILE / ${progress}%`}
        </p>
        {!reducedMotion && (
          <div className="terminal-controls">
            {!complete ? (
              <>
                <button type="button" onClick={() => setPaused(!paused)}>
                  {paused ? <Play size={12} /> : <Pause size={12} />}
                  {paused ? "Resume animation" : "Pause animation"}
                </button>
                <button type="button" onClick={() => setProgress(100)}>
                  Show all now
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setProgress(0);
                  setPaused(false);
                }}
              >
                <RotateCcw size={12} />
                Replay animation
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
