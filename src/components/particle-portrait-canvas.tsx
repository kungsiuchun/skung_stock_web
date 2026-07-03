import { useEffect, useRef } from "react";

type ParticlePortraitCanvasProps = {
  src: string;
  alt: string;
  className?: string;
};

type Particle = {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  r: number;
  g: number;
  b: number;
  size: number;
  phase: number;
  drift: number;
  delay: number;
  duration: number;
};

const PAPER_ALPHA_THRESHOLD = 90;

const isPaperPixel = (r: number, g: number, b: number, a: number) => {
  if (a < PAPER_ALPHA_THRESHOLD) {
    return true;
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const average = (max + min) / 2;

  return average > 206 && max - min < 48;
};

const colorForPixel = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max - min;

  if (r > g && g >= b && saturation > 26 && r > 92) {
    const factor = Math.max(0.82, Math.min(1.14, lightness / 132));
    return {
      r: Math.min(255, Math.round(236 * factor)),
      g: Math.min(255, Math.round(84 * factor)),
      b: Math.min(255, Math.round(34 * factor)),
    };
  }

  const factor = Math.max(0.7, Math.min(1.12, lightness / 78));
  return {
    r: Math.round(24 * factor),
    g: Math.round(21 * factor),
    b: Math.round(18 * factor),
  };
};

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

export function ParticlePortraitCanvas({ src, alt, className = "" }: ParticlePortraitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  const startRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const image = new Image();
    image.decoding = "async";
    image.src = src;

    let disposed = false;
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    let resizeTimer: number | undefined;

    const measure = () => {
      const rect = parent.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const buildParticles = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        return;
      }

      measure();

      const sampleWidth = window.innerWidth < 720 ? 280 : 440;
      const sampleHeight = Math.max(1, Math.round(sampleWidth * (cssHeight / cssWidth)));
      const offscreen = document.createElement("canvas");
      offscreen.width = sampleWidth;
      offscreen.height = sampleHeight;
      const offscreenCtx = offscreen.getContext("2d", { willReadFrequently: true });

      if (!offscreenCtx) {
        return;
      }

      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = sampleWidth / sampleHeight;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;

      if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
      } else {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
      }

      offscreenCtx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sampleWidth,
        sampleHeight,
      );

      const pixels = offscreenCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
      let subjectPixels = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        if (!isPaperPixel(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) {
          subjectPixels += 1;
        }
      }

      const targetCount = window.innerWidth < 720 ? 9000 : 26000;
      const step = Math.max(2, Math.round(Math.sqrt(subjectPixels / targetCount)));
      const nextParticles: Particle[] = [];
      const entryOffset = cssWidth * 0.52;

      for (let y = 0; y < sampleHeight; y += step) {
        for (let x = 0; x < sampleWidth; x += step) {
          const index = (y * sampleWidth + x) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const a = pixels[index + 3];

          if (isPaperPixel(r, g, b, a)) {
            continue;
          }

          const color = colorForPixel(r, g, b);
          const nx = x / sampleWidth;
          const ny = y / sampleHeight;
          const tx = nx * cssWidth;
          const ty = ny * cssHeight;

          nextParticles.push({
            x: tx - entryOffset * (0.4 + Math.random() * 0.55),
            y: ty + (Math.random() - 0.5) * 170,
            sx: tx - entryOffset * (0.4 + Math.random() * 0.55),
            sy: ty + (Math.random() - 0.5) * 170,
            tx,
            ty,
            r: color.r,
            g: color.g,
            b: color.b,
            size: 0.62 + Math.random() * 0.95,
            phase: Math.random() * Math.PI * 2,
            drift: Math.max(0, (0.18 - nx) / 0.18),
            delay: nx * 620 + Math.random() * 260,
            duration: 760 + Math.random() * 520,
          });
        }
      }

      particlesRef.current = nextParticles;
      startRef.current = performance.now();
    };

    const drawFrame = (now: number) => {
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const elapsed = now - startRef.current;
      const time = now * 0.001;
      const mouse = mouseRef.current;
      const settleMs = 1500;

      for (const particle of particlesRef.current) {
        let x = particle.tx;
        let y = particle.ty;
        let alpha = 1;
        let hoverBoost = 0;

        if (!reduceMotion && elapsed < settleMs) {
          const localProgress = (elapsed - particle.delay) / particle.duration;
          const progress = localProgress <= 0 ? 0 : localProgress >= 1 ? 1 : easeOutCubic(localProgress);
          x = particle.sx + (particle.tx - particle.sx) * progress;
          y = particle.sy + (particle.ty - particle.sy) * progress;
          alpha = Math.max(0, Math.min(1, localProgress + 0.16));
        } else if (!reduceMotion) {
          x = particle.tx - 12 * particle.drift * (0.5 + Math.sin(time * 0.7 + particle.phase) * 0.5);
          y = particle.ty + Math.cos(time * 0.86 + particle.phase) * 0.7;

          if (mouse.active) {
            const dx = x - mouse.x;
            const dy = y - mouse.y;
            const distanceSquared = dx * dx + dy * dy;
            const radius = Math.max(120, Math.min(190, cssWidth * 0.22));

            if (distanceSquared < radius * radius) {
              const distance = Math.sqrt(distanceSquared) || 1;
              const force = 1 - distance / radius;
              const push = force * 34;
              hoverBoost = force;
              x += (dx / distance) * push + Math.sin(time * 8 + particle.phase) * force * 5;
              y += (dy / distance) * push + Math.cos(time * 7 + particle.phase) * force * 5;
            }
          }
        }

        if (alpha <= 0.01) {
          continue;
        }

        const size = particle.size * (1 + hoverBoost * 0.8);
        ctx.globalAlpha = alpha * 0.1;
        ctx.fillStyle = `rgb(${particle.r},${particle.g},${particle.b})`;
        ctx.fillRect(x - 0.25, y - 0.25, size + 0.5, size + 0.5);
        ctx.globalAlpha = alpha;
        ctx.fillRect(x, y, size, size);
      }

      ctx.globalAlpha = 1;

      if (!reduceMotion && !disposed) {
        frameRef.current = requestAnimationFrame(drawFrame);
      }
    };

    const start = () => {
      buildParticles();
      frameRef.current = requestAnimationFrame(drawFrame);
    };

    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        buildParticles();
      }, 140) as unknown as number;
    };

    const handleVisibility = () => {
      if (document.hidden && frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      } else if (!reduceMotion) {
        startRef.current = performance.now() - 1600;
        frameRef.current = requestAnimationFrame(drawFrame);
      }
    };

    image.addEventListener("load", start, { once: true });
    if (image.complete) {
      start();
    }

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(parent);
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [src]);

  return (
    <div
      className={`relative overflow-visible ${className}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        mouseRef.current = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          active: true,
        };
      }}
      onPointerLeave={() => {
        mouseRef.current.active = false;
      }}
    >
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover opacity-[0.68] mix-blend-multiply contrast-[1.18] saturate-[1.08]"
        draggable={false}
      />
      <canvas ref={canvasRef} className="absolute inset-0 z-10" aria-hidden="true" />
    </div>
  );
}
