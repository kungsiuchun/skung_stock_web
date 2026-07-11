import { ArrowRight } from "lucide-react";
import { ParticlePortraitCanvas } from "@/components/particle-portrait-canvas";

type HomeLandingPageProps = {
  onOpenMarketLab: () => void;
  onOpenPhotography: () => void;
};

const HERO_IMAGE = "/image/siu-hero-particle-source-v2.png";

export function HomeLandingPage({ onOpenMarketLab, onOpenPhotography }: HomeLandingPageProps) {
  return (
    <section className="relative h-full min-h-screen overflow-hidden bg-[#f4efe6] text-[#1a1714]">
      <div className="pointer-events-none absolute inset-3 border border-[#c9c0b2]/80 sm:inset-5" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(26,23,20,0.045)_1px,transparent_1px)] [background-size:4px_4px]" />
      <div className="pointer-events-none absolute left-[4.4rem] top-28 hidden h-[calc(100%-10rem)] w-px bg-[#c9c0b2]/60 md:block" />

      <div className="relative z-10 grid min-h-[100dvh] grid-cols-1 px-8 pb-10 pt-28 sm:px-12 sm:pt-24 lg:grid-cols-[48%_52%] lg:px-20 lg:pb-7 lg:pt-20">
        <div className="flex flex-col justify-center lg:min-h-0 lg:pb-[4vh]">
          <h1 className="font-serif text-[clamp(5.5rem,17vw,16rem)] font-semibold leading-[0.8] tracking-[-0.035em] text-[#16130f]">
            Siu
          </h1>

          <div className="mt-8 max-w-[38rem] lg:ml-2 lg:mt-7">
            <p className="flex items-center gap-4 font-mono text-xs uppercase tracking-[0.36em] text-[#d65e2d] sm:text-sm">
              <span className="h-3 w-3 rounded-full bg-[#e2632f]" />
              AI media <span aria-hidden="true">x</span> Build in public
            </p>

            <div className="mt-7 h-px w-10 bg-[#1a1714]/50 lg:mt-6" />

            <p className="mt-7 max-w-[34rem] text-[clamp(2rem,2.72vw,3.05rem)] font-light leading-[1.16] tracking-[-0.02em] text-[#1d1a17] lg:mt-5">
              Exploring wealth, work,
              <br />
              and creative technology.
            </p>

            <div className="mt-10 flex max-w-[34rem] flex-col gap-4 sm:flex-row lg:mt-8">
              <button
                type="button"
                onClick={onOpenMarketLab}
                className="group flex h-16 flex-1 items-center justify-center gap-3 whitespace-nowrap border border-[#1a1714]/80 bg-transparent px-5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#1a1714] transition-colors hover:bg-[#1a1714] hover:text-[#f4efe6] focus:outline-none focus:ring-2 focus:ring-[#e2632f] sm:text-[0.74rem] lg:h-14"
              >
                Explore work
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
              <button
                type="button"
                onClick={onOpenPhotography}
                className="group flex h-16 flex-1 items-center justify-center gap-3 whitespace-nowrap border border-[#1a1714]/80 bg-transparent px-5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#1a1714] transition-colors hover:bg-[#1a1714] hover:text-[#f4efe6] focus:outline-none focus:ring-2 focus:ring-[#e2632f] sm:text-[0.74rem] lg:h-14"
              >
                View photography
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </div>

        <div className="relative -mx-8 mt-12 min-h-[29rem] sm:-mx-12 sm:mt-4 sm:min-h-[48vh] lg:mx-0 lg:mt-0 lg:min-h-0">
          <ParticlePortraitCanvas
            src={HERO_IMAGE}
            alt="Siu editorial duotone portrait"
            className="relative ml-auto h-[29rem] w-[140%] translate-x-[10%] sm:absolute sm:right-[-8%] sm:top-[-2%] sm:h-[108%] sm:w-[114%] sm:translate-x-0 lg:right-0 lg:top-[-4%] lg:h-[108%] lg:w-full xl:h-[110%]"
          />
        </div>
      </div>
    </section>
  );
}
