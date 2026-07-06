import { ArrowRight } from "lucide-react";
import { ParticlePortraitCanvas } from "@/components/particle-portrait-canvas";

type HomeLandingPageProps = {
  onOpenMarketLab: () => void;
  onOpenPhotography: () => void;
};

const HERO_IMAGE = "/image/siu-hero-particle-source.png";

export function HomeLandingPage({ onOpenMarketLab, onOpenPhotography }: HomeLandingPageProps) {
  return (
    <section className="relative h-full min-h-screen overflow-hidden bg-[#f4efe6] text-[#1a1714]">
      <div className="pointer-events-none absolute inset-3 border border-[#c9c0b2]/80 sm:inset-5" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(26,23,20,0.045)_1px,transparent_1px)] [background-size:4px_4px]" />
      <div className="pointer-events-none absolute left-[4.4rem] top-28 hidden h-[calc(100%-10rem)] w-px bg-[#c9c0b2]/60 md:block" />
      <div className="pointer-events-none absolute bottom-10 left-[4.1rem] hidden h-8 w-8 text-[#1a1714]/50 md:block">
        <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
        <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
      </div>
      <div className="pointer-events-none absolute right-8 top-8 h-8 w-8 text-[#1a1714]/35">
        <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
        <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
      </div>
      <div className="pointer-events-none absolute bottom-8 right-8 h-8 w-8 text-[#1a1714]/25">
        <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
        <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
      </div>

      <div className="relative z-10 grid h-full min-h-screen grid-cols-1 px-8 pb-10 pt-32 sm:px-12 sm:pt-24 lg:grid-cols-[47%_53%] lg:px-20 lg:pb-7 lg:pt-24">
        <div className="flex flex-col justify-start lg:min-h-0 lg:pt-[8.5vh] xl:pt-[7vh]">
          <h1 className="font-serif text-[clamp(5.5rem,19vw,18rem)] font-semibold leading-[0.78] tracking-[-0.025em] text-[#16130f]">
            Siu
          </h1>

          <div className="mt-8 max-w-[43rem] lg:ml-2 lg:mt-8">
            <p className="flex items-center gap-4 font-mono text-xs uppercase tracking-[0.36em] text-[#d65e2d] sm:text-sm">
              <span className="h-3 w-3 rounded-full bg-[#e2632f]" />
              AI Product Builder <span aria-hidden="true">x</span> Visual Identity
            </p>

            <div className="mt-7 h-px w-10 bg-[#1a1714]/50 lg:mt-6" />

            <p className="mt-7 max-w-[36rem] text-[clamp(2rem,2.72vw,3.05rem)] font-light leading-[1.16] tracking-[-0.02em] text-[#1d1a17] lg:mt-5">
              Market tools, photography,
              <br />
              and practical AI products.
            </p>

            <div className="mt-10 flex max-w-[37rem] flex-col gap-4 sm:flex-row lg:mt-8">
              <button
                type="button"
                onClick={onOpenMarketLab}
                className="group flex h-16 flex-1 items-center justify-center gap-6 border border-[#1a1714]/80 bg-transparent px-7 font-mono text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-[#1a1714] transition-colors hover:bg-[#1a1714] hover:text-[#f4efe6] focus:outline-none focus:ring-2 focus:ring-[#e2632f] sm:text-sm lg:h-14"
              >
                Open Market Lab
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
              <button
                type="button"
                onClick={onOpenPhotography}
                className="group flex h-16 flex-1 items-center justify-center gap-6 border border-[#1a1714]/80 bg-transparent px-7 font-mono text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-[#1a1714] transition-colors hover:bg-[#1a1714] hover:text-[#f4efe6] focus:outline-none focus:ring-2 focus:ring-[#e2632f] sm:text-sm lg:h-14"
              >
                View Photography
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </div>

        <div className="relative -mx-8 mt-14 min-h-[27rem] sm:-mx-12 sm:mt-4 sm:min-h-[43vh] lg:mx-0 lg:mt-0 lg:min-h-0">
          <div className="absolute left-0 top-[10%] hidden h-px w-[34%] bg-[#c9c0b2]/70 lg:block" />
          <div className="absolute left-[23%] top-[9%] hidden h-8 w-8 text-[#1a1714]/65 lg:block">
            <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
          </div>
          <div className="absolute bottom-[7%] left-[6%] hidden h-11 w-11 text-[#1a1714]/45 lg:block">
            <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
          </div>
          <div className="absolute right-[12%] top-[38%] h-12 w-12 text-[#1a1714]/30">
            <span className="absolute left-1/2 top-0 h-full w-px bg-current" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-current" />
          </div>

          <ParticlePortraitCanvas
            src={HERO_IMAGE}
            alt="Siu editorial duotone portrait"
            className="relative ml-auto h-[27rem] w-[132%] translate-x-[8%] sm:absolute sm:right-[-9%] sm:top-[-1%] sm:h-[102%] sm:w-[104%] sm:translate-x-0 lg:right-[-11%] lg:top-[3%] lg:h-[92%] lg:w-[104%] xl:right-[-10%] xl:top-[2.5%] xl:h-[94%]"
          />
        </div>
      </div>
    </section>
  );
}
