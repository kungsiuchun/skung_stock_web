import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Terminal } from 'lucide-react';

const RUN_MS = 6800;
const HOLD_MS = 10000;

const resumeLines = [
  '$ siu resume --build',
  '10:12:01  loading profile: SiuChun Wilson Kung',
  '10:12:02  indexing 4+ years of data work',
  '10:12:03  compiling Python / SQL / JavaScript',
  '10:12:05  linking Power BI + Tableau dashboards',
  '10:12:07  automating marketing KPI reports',
  '10:12:08  analyzing Paid Search / Social / YouTube',
  '10:12:09  validating Fabric + Power BI certs',
  '10:12:10  rendering About page profile',
];

const resumeHighlights = [
  ['Current', 'Data Analyst · Canvas Worldwide'],
  ['Core', 'Power BI, Excel models, KPI automation'],
  ['Base', 'B.S. Computer Science · SFSU'],
];

const clampProgress = (value: number) => Math.min(100, Math.max(0, value));

export const AboutResumeTerminal = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(motionQuery.matches);

    updateMotionPreference();
    motionQuery.addEventListener('change', updateMotionPreference);

    return () => motionQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setProgress(100);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const cycleMs = RUN_MS + HOLD_MS;

    const render = (now: number) => {
      const elapsed = (now - startedAt) % cycleMs;
      const nextProgress = elapsed < RUN_MS ? clampProgress((elapsed / RUN_MS) * 100) : 100;

      setProgress(nextProgress);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => cancelAnimationFrame(frame);
  }, [prefersReducedMotion]);

  const fullText = resumeLines.join('\n');
  const visibleText = useMemo(() => {
    if (prefersReducedMotion || progress >= 100) {
      return fullText;
    }

    const textProgress = Math.min(1, progress / 92);
    return fullText.slice(0, Math.floor(fullText.length * textProgress));
  }, [fullText, prefersReducedMotion, progress]);

  const roundedProgress = Math.round(progress);
  const compileLabel =
    roundedProgress >= 100 ? 'compiled' : roundedProgress >= 78 ? 'finalizing...' : 'compiling...';

  return (
    <div className="relative w-full max-w-[500px]" aria-label="Animated resume build terminal">
      <div
        aria-hidden="true"
        className="absolute -left-6 top-8 hidden h-28 w-28 border border-cyan-300/18 bg-[linear-gradient(rgba(103,232,249,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.08)_1px,transparent_1px)] bg-[size:18px_18px] lg:block"
      />
      <div
        aria-hidden="true"
        className="absolute -right-5 -top-5 hidden h-16 w-24 border border-white/10 lg:block"
      >
        <span className="absolute left-3 top-3 font-mono text-[10px] uppercase tracking-normal text-white/32">
          0 50 100
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-[#c9c0b2]/55 bg-[#f4efe6] text-[#1a1714] shadow-[0_30px_90px_rgba(0,0,0,0.36)]">
        <div className="flex items-center justify-between border-b border-[#c9c0b2]/80 bg-[#ede4d6] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f0652e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d8aa39]" />
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-normal text-[#1a1714]/55">
            <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
            resume-build.exe
          </div>
        </div>

        <div className="relative min-h-[322px] p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-[#c9c0b2]/70 pb-4">
            <div>
              <p className="font-mono text-[11px] font-black uppercase tracking-normal text-[#f0652e]">SIU / RESUME</p>
              <p className="mt-1 text-xl font-black leading-none tracking-normal text-[#1a1714] sm:text-2xl">
                Build verified profile
              </p>
            </div>
            <FileText aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#1a1714]/48" />
          </div>

          <pre className="min-h-[172px] whitespace-pre-wrap font-mono text-[11px] font-semibold leading-5 tracking-normal text-[#1a1714]/78 sm:text-xs">
            {visibleText}
            {!prefersReducedMotion && roundedProgress < 100 ? <span className="animate-pulse">_</span> : null}
          </pre>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] font-black uppercase tracking-normal text-[#1a1714]/62">
              <span>4+ yrs · {compileLabel}</span>
              <span>{roundedProgress}%</span>
            </div>
            <div className="h-3 overflow-hidden border border-[#1a1714]/20 bg-[#1a1714]/8">
              <div
                className="h-full bg-[linear-gradient(90deg,#f0652e,#67e8f9)] transition-[width] duration-150 ease-linear"
                style={{ width: `${roundedProgress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid border-x border-b border-white/10 bg-white/[0.035] sm:grid-cols-3">
        {resumeHighlights.map(([label, value]) => (
          <div key={label} className="min-h-[76px] border-t border-white/10 p-3 sm:border-r sm:last:border-r-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
              <Check aria-hidden="true" className="h-3 w-3" />
              {label}
            </div>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/62">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
