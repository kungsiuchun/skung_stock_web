import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, Code2, Cpu, Focus, Gauge, Layers, ScanLine, Zap } from 'lucide-react';
import { portfolioConfig } from '@/config/portfolio';
import { AboutResumeTerminal } from './about-resume-terminal';

const specs = [
  {
    label: '24.2MP DX CMOS',
    detail: 'Enough detail to treat every frame like a design surface.',
    icon: ScanLine,
  },
  {
    label: 'EXPEED 4',
    detail: 'Clean processing for fast edits and crisp portfolio images.',
    icon: Cpu,
  },
  {
    label: 'ISO 100-25600',
    detail: 'Range for night streets, indoor light, and imperfect conditions.',
    icon: Gauge,
  },
  {
    label: '11-point AF',
    detail: 'Simple focus system that rewards discipline and timing.',
    icon: Focus,
  },
  {
    label: '5 fps',
    detail: 'Fast enough to catch a gesture before it disappears.',
    icon: Zap,
  },
  {
    label: 'F-mount DX',
    detail: 'A lens system that can grow with the visual language.',
    icon: Aperture,
  },
];

const proofImages = portfolioConfig.images
  .filter((image) => image.src.startsWith('/image/'))
  .slice(0, 5);

export const AboutPage = () => {
  const pageRef = useRef<HTMLElement | null>(null);
  const cameraSectionRef = useRef<HTMLElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(motionQuery.matches);

    updateMotionPreference();
    motionQuery.addEventListener('change', updateMotionPreference);

    return () => {
      motionQuery.removeEventListener('change', updateMotionPreference);
    };
  }, []);

  useEffect(() => {
    const updateProgress = () => {
      const page = pageRef.current;
      const section = cameraSectionRef.current;
      if (!page || !section) return;

      const rect = section.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const viewportHeight = page.clientHeight || window.innerHeight || 1;
      const rawProgress = (pageRect.bottom - rect.top) / (viewportHeight + rect.height);
      setScrollProgress(Math.min(1, Math.max(0, rawProgress)));
    };

    updateProgress();
    const page = pageRef.current;
    page?.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);

    return () => {
      page?.removeEventListener('scroll', updateProgress);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, []);

  const cameraMotion = useMemo(() => {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const t = clamp(value);
      return t * t * (3 - 2 * t);
    };
    const sceneProgress = smooth(scrollProgress);
    const scanProgress = smooth((scrollProgress - 0.24) / 0.39);
    const visualProgress = prefersReducedMotion ? 0 : sceneProgress;
    const lift = prefersReducedMotion ? 0 : Math.sin(sceneProgress * Math.PI) * -18;
    const scale = 0.94;
    const scanY = -18 + scanProgress * 132;
    const scanTop = Math.min(82, Math.max(0, scanProgress * 100 - 8));
    const scanBottomInset = Math.max(0, 100 - scanTop - 18);

    return {
      image: {
        transform: `translateY(calc(-50% + ${lift}px)) scale(${scale})`,
        filter: `drop-shadow(0 ${32 + visualProgress * 10}px ${52 + visualProgress * 18}px rgba(0,0,0,0.76)) saturate(${0.94 + visualProgress * 0.14}) contrast(${1.05 + visualProgress * 0.06})`,
      },
      scanImage: {
        clipPath: `inset(${scanTop}% 0 ${scanBottomInset}% 0)`,
        transform: `translateY(calc(-50% + ${lift}px)) scale(${scale})`,
        filter: 'brightness(1.9) saturate(1.6) contrast(1.2) drop-shadow(0 0 22px rgba(103,232,249,0.9))',
        opacity: scanProgress > 0 && scanProgress < 1 ? 0.82 + Math.sin(scanProgress * Math.PI) * 0.14 : 0.36,
      },
      grid: {
        transform: `translate3d(${-10 + visualProgress * 20}px, ${8 - visualProgress * 16}px, 0)`,
        opacity: 0.22 + visualProgress * 0.18,
      },
      halo: {
        transform: `translate(-50%, -50%) scale(${0.88 + visualProgress * 0.22})`,
        opacity: 0.28 + visualProgress * 0.24,
      },
      iris: {
        transform: `translate(-50%, -50%) scale(${0.86 + visualProgress * 0.12})`,
        opacity: 0.18 + visualProgress * 0.2,
      },
      scan: {
        top: `${scanY}%`,
        opacity: scanProgress > 0 && scanProgress < 1 ? 0.82 + Math.sin(scanProgress * Math.PI) * 0.14 : 0.46,
      },
      scanNeedle: {
        top: `${scanY + 15}%`,
        opacity: scanProgress > 0 && scanProgress < 1 ? 0.74 + Math.sin(scanProgress * Math.PI) * 0.18 : 0.34,
      },
      readout: {
        width: `${scanProgress * 100}%`,
      },
      displayProgress: scanProgress,
    };
  }, [prefersReducedMotion, scrollProgress]);

  const activeSpecIndex = Math.min(specs.length - 1, Math.ceil(cameraMotion.displayProgress * specs.length) - 1);

  return (
    <section ref={pageRef} className="h-full overflow-y-auto bg-[#111111] text-white">
      <div className="min-h-screen px-6 pb-16 pt-28 md:px-12 lg:px-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.18fr_0.82fr] lg:items-center">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-white/55">
              <Code2 aria-hidden="true" className="h-3.5 w-3.5 text-cyan-300" />
              About SIU
            </div>
            <h1 className="max-w-5xl text-4xl font-black leading-[1.02] tracking-normal text-white md:text-6xl lg:text-7xl">
              I build tools with code, frame moments with a camera, and test ideas against real systems.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-white/62 md:text-xl">
              A creative developer moving between interface design, AI workflows, market dashboards, and visual storytelling.
              <span className="mt-3 block text-white/80">用 code 做工具，用鏡頭建立視覺語言。</span>
            </p>
          </div>

          <div className="grid gap-4 lg:justify-items-end">
            <AboutResumeTerminal />

            <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-[500px] lg:grid-cols-1">
              {[
                ['Creative Developer', 'Usable tools, not empty demos.'],
                ['Visual Thinker', 'Composition, timing, and restraint.'],
                ['Systems Experimenter', 'AI and markets tested in public UI.'],
              ].map(([title, body]) => (
                <div key={title} className="border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">{title}</p>
                  <p className="mt-2 text-sm leading-5 text-white/58">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-24 h-px bg-white/10" />
      </div>

      <section ref={cameraSectionRef} className="relative min-h-[240vh] px-6 py-16 md:px-12 lg:px-20">
        <div className="sticky top-20 mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">Visual tool</p>
            <h2 className="mt-3 text-4xl font-black leading-none tracking-normal md:text-5xl">
              Nikon D3500 as a working instrument.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/58 md:text-base">
              The camera is not the headline. It is the evidence: a light DSLR used to train attention, build taste, and turn ordinary scenes into visual decisions.
            </p>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {specs.map((spec, index) => {
                const Icon = spec.icon;
                const isActive = index <= activeSpecIndex;

                return (
                  <div
                    key={spec.label}
                    className={`flex min-h-[88px] items-start gap-3 border p-3 ${
                      isActive
                        ? 'translate-x-0 border-cyan-300/35 bg-cyan-300/[0.07] opacity-100'
                        : 'translate-x-4 border-white/10 bg-white/[0.025] opacity-38'
                    } transition-[opacity,transform,border-color,background-color] duration-500`}
                  >
                    <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center border ${isActive ? 'border-cyan-300/40 text-cyan-200' : 'border-white/10 text-white/35'}`}>
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-white">{spec.label}</p>
                      <p className="mt-1 text-xs leading-5 text-white/55">{spec.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-[340px] overflow-hidden md:min-h-[460px]">
            <div className="absolute inset-0 border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.085),rgba(255,255,255,0.012))]" />
            <div
              aria-hidden="true"
              className="absolute -inset-10 bg-[linear-gradient(rgba(103,232,249,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.06)_1px,transparent_1px)] bg-[size:48px_48px] will-change-transform"
              style={cameraMotion.grid}
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[66%] w-[72%] rounded-full bg-[radial-gradient(circle,rgba(103,232,249,0.18),rgba(103,232,249,0.045)_42%,transparent_70%)] blur-2xl will-change-transform"
              style={cameraMotion.halo}
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-52 w-52 rounded-full border border-cyan-300/18 bg-[conic-gradient(from_90deg,transparent,rgba(103,232,249,0.2),transparent_36%,rgba(255,255,255,0.08),transparent_70%)] blur-[1px] will-change-transform md:h-72 md:w-72"
              style={cameraMotion.iris}
            />
            <div className="absolute left-6 top-6 z-10 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.24em] text-white/45">
              <Layers aria-hidden="true" className="h-4 w-4 text-cyan-300" />
              Scroll-calibrated scan
            </div>
            <div
              aria-hidden="true"
              data-scan-band="nikon"
              className="absolute left-0 right-0 z-20 h-[34%] bg-[linear-gradient(180deg,transparent,rgba(103,232,249,0.08)_18%,rgba(103,232,249,0.62)_48%,rgba(255,255,255,0.5)_52%,rgba(103,232,249,0.16)_76%,transparent)] mix-blend-screen blur-[1px] will-change-[top,opacity]"
              style={cameraMotion.scan}
            />
            <div
              aria-hidden="true"
              data-scan-needle="nikon"
              className="absolute left-0 right-0 z-30 h-px bg-cyan-200 shadow-[0_0_18px_rgba(103,232,249,1),0_0_42px_rgba(103,232,249,0.72)] will-change-[top,opacity]"
              style={cameraMotion.scanNeedle}
            />
            <img
              src="/image/nikon-d3500-product.png"
              alt="Nikon D3500 DSLR camera"
              width={700}
              height={595}
              loading="lazy"
              decoding="async"
              className="absolute inset-x-0 top-[52%] mx-auto w-[78%] max-w-2xl select-none will-change-transform md:w-[74%]"
              style={cameraMotion.image}
            />
            <img
              src="/image/nikon-d3500-product.png"
              alt=""
              data-scan-image="nikon"
              width={700}
              height={595}
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute inset-x-0 top-[52%] z-10 mx-auto w-[78%] max-w-2xl select-none mix-blend-screen will-change-[clip-path,opacity,transform,filter] md:w-[74%]"
              style={cameraMotion.scanImage}
            />
            <div className="absolute bottom-6 left-6 right-6 z-20 grid grid-cols-[1fr_auto] items-end gap-x-8 border-t border-white/10 pt-5">
              <div className="col-span-2 mb-4 h-px w-full bg-white/10">
                <div className="h-px bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)] transition-[width] duration-200 ease-out" style={cameraMotion.readout} />
              </div>
              <span className="min-w-0 text-xs uppercase tracking-[0.22em] text-white/42">Nikon D3500 product scan</span>
              <span className="text-right text-xs uppercase tracking-[0.22em] text-white/42">{Math.round(Number(cameraMotion.displayProgress) * 100)}% scan</span>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 pt-10 md:px-12 lg:px-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">Proof strip</p>
              <h2 className="mt-3 text-3xl font-black tracking-normal text-white md:text-5xl">Frames from the same visual system.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/52">
              A compact sample, not a gallery. The point is judgment: what gets framed, what gets ignored, and what earns attention.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {proofImages.map((image, index) => (
              <figure key={image.id} className={`group relative overflow-hidden border border-white/10 bg-white/[0.03] ${index === 0 ? 'md:row-span-2' : ''}`}>
                <img
                  src={image.src}
                  alt={image.alt}
                  width={1920}
                  height={1280}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/4] h-full w-full object-cover grayscale-[18%] transition duration-500 group-hover:scale-105 group-hover:grayscale-0"
                />
              </figure>
            ))}
          </div>

          <p className="mt-16 max-w-4xl text-3xl font-black leading-tight tracking-normal text-white md:text-5xl">
            Built with code. Framed through glass. Tested in real systems.
          </p>
        </div>
      </section>
    </section>
  );
};
