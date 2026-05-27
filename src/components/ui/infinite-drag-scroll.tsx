import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  wrap,
} from "motion/react";
import {
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  createContext,
} from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

//Types
type variants = "default" | "masonry" | "polaroid";

// Create Context
const GridVariantContext = createContext<variants | undefined>(undefined);

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
  variant,
}: {
  className?: string;
  children: React.ReactNode;
  variant?: variants;
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
    <GridVariantContext.Provider value={variant}>
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
    </GridVariantContext.Provider>
  );
};

export const GridItem = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const variant = useContext(GridVariantContext);

  const gridItemStyles = cva(
    "overflow-hidden hover:cursor-pointer w-full h-full will-change-transform",
    {
      variants: {
        variant: {
          default: "rounded-sm",
          masonry: "rounded-sm",
          polaroid:
            "border-[10px] border-b-[28px] border-white shadow-xl even:rotate-3 odd:-rotate-2 hover:rotate-0 transition-transform ease-out duration-300",
        },
      },
      defaultVariants: {
        variant: "default",
      },
    },
  );

  return (
    <motion.div
      className={cn(gridItemStyles({ variant, className }))}
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
    const variant = useContext(GridVariantContext);

    const gridBodyStyles = cva("grid grid-cols-[repeat(6,1fr)] h-fit w-fit", {
      variants: {
        variant: {
          default: "gap-14 p-7 md:gap-28 md:p-14",
          masonry: "gap-14 p-7 md:gap-28 md:p-14",
          polaroid: "gap-14 p-7 md:gap-28 md:p-14",
        },
      },
      defaultVariants: {
        variant: "default",
      },
    });

    return (
      <>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={cn(gridBodyStyles({ variant, className }))}
          >
            {children}
          </div>
        ))}
      </>
    );
  },
);

GridBody.displayName = "GridBody";
