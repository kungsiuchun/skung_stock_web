import { Linkedin, Mail, MapPin } from "lucide-react";

export function ContactPage() {
  return (
    <section className="relative h-full min-h-screen overflow-hidden bg-[#f4efe6] px-8 pb-12 pt-28 text-[#1a1714] sm:px-12 lg:px-20">
      <div className="pointer-events-none absolute inset-3 border border-[#c9c0b2]/80 sm:inset-5" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(26,23,20,0.04)_1px,transparent_1px)] [background-size:4px_4px]" />
      <div className="relative z-10 mx-auto grid h-full max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
        <div className="self-start pt-10">
          <p className="font-mono text-xs uppercase tracking-[0.36em] text-[#d65e2d]">
            Contact / Open loop
          </p>
          <h1 className="mt-8 max-w-3xl font-serif text-[clamp(5rem,14vw,14rem)] font-semibold leading-[0.84] tracking-[-0.025em]">
            Let's
            <br />
            build.
          </h1>
        </div>

        <div className="mb-4 max-w-3xl border-t border-[#1a1714]/30 pt-8 lg:mb-16">
          <p className="text-[clamp(1.8rem,3.8vw,4.5rem)] font-light leading-[1.08] tracking-[-0.03em]">
            AI products, market tools, photography, and sharp ideas that deserve a working prototype.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="border border-[#1a1714]/50 p-5">
              <Mail className="h-5 w-5" />
              <span className="mt-8 block font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[#1a1714]/70">
                Email
              </span>
              <span className="mt-2 block text-sm">Ready to wire</span>
            </div>
            <div className="border border-[#1a1714]/50 p-5">
              <Linkedin className="h-5 w-5" />
              <span className="mt-8 block font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[#1a1714]/70">
                LinkedIn
              </span>
              <span className="mt-2 block text-sm">Profile link</span>
            </div>
            <div className="border border-[#1a1714]/50 p-5">
              <MapPin className="h-5 w-5" />
              <span className="mt-8 block font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[#1a1714]/70">
                Base
              </span>
              <span className="mt-2 block text-sm">United States / Hong Kong lens</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
