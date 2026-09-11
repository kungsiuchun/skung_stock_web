import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  wrap,
} from "motion/react";
import {
  memo,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

//Motion Variants
const rowVariants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: () => ({
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.45,
      ease: cubicBezier(0.22, 1, 0.36, 1),
    },
  }),
};

export const DraggableContainer = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const wrapBoundsRef = useRef({ x: -1, y: -1 });
  const isDraggingRef = useRef(false);
  const wheelAnimationRef = useRef<ReturnType<typeof animate> | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const handleIsDragging = () => {
    isDraggingRef.current = true;
    wheelAnimationRef.current?.stop();
  };
  const handleIsNotDragging = () => {
    isDraggingRef.current = false;
  };

  useLayoutEffect(() => {
    if (!ref.current) return;

    const updateDimensions = () => {
      if (!ref.current) return;
      const { width, height } = ref.current.getBoundingClientRect();
      wrapBoundsRef.current = {
        x: -(width / 2),
        y: -(height / 2),
      };
    };

    updateDimensions();

    const xDrag = x.on("change", (latest) => {
      const wrappedX = wrap(wrapBoundsRef.current.x, 0, latest);
      if (latest !== wrappedX) x.set(wrappedX);
    });

    const yDrag = y.on("change", (latest) => {
      const wrappedY = wrap(wrapBoundsRef.current.y, 0, latest);
      if (latest !== wrappedY) y.set(wrappedY);
    });

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(ref.current);

    const handleWheelScroll = (event: WheelEvent) => {
      if (!isDraggingRef.current) {
        event.preventDefault();
        const cappedDelta = Math.max(-90, Math.min(90, event.deltaY));

        wheelAnimationRef.current?.stop();
        wheelAnimationRef.current = animate(y, y.get() - cappedDelta * 0.62, {
          type: "tween",
          duration: 0.42,
          ease: cubicBezier(0.22, 1, 0.36, 1),
        });
      }
    };

    window.addEventListener("wheel", handleWheelScroll, { passive: false });
    return () => {
      wheelAnimationRef.current?.stop();
      xDrag();
      yDrag();
      resizeObserver.disconnect();
      window.removeEventListener("wheel", handleWheelScroll);
    };
  }, [x, y]);

  return (
    <div className="h-dvh overflow-hidden bg-[#141414]">
      <motion.div
        className="h-dvh overflow-hidden"
      >
        <motion.div
          className={cn(
            "grid h-fit w-fit cursor-grab grid-cols-[repeat(2,1fr)] active:cursor-grabbing will-change-transform",
            className,
          )}
          drag
          dragConstraints={{ left: -10000, right: 10000, top: -10000, bottom: 10000 }} // Arbitrary large constraints to prevent drag inhibition
          dragElastic={0}
          dragMomentum={false}
          onDragStart={handleIsDragging}
          onDragEnd={handleIsNotDragging}
          style={{ x, y }}
          ref={ref}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
};

export const GridItem = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <motion.div
      className={cn(
        "h-full w-full overflow-hidden border-[10px] border-b-[28px] border-white shadow-xl transition-transform duration-300 ease-out even:rotate-3 odd:-rotate-2 hover:rotate-0 hover:cursor-pointer will-change-transform",
        className,
      )}
      variants={rowVariants}
      initial="initial"
      animate="animate"
    >
      {children}
    </motion.div>
  );
};

export const GridBody = memo(
  ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => {
    return (
      <>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "grid h-fit w-fit grid-cols-[repeat(6,1fr)] gap-14 p-7 md:gap-28 md:p-14",
              className,
            )}
          >
            {children}
          </div>
        ))}
      </>
    );
  },
);

GridBody.displayName = "GridBody";
