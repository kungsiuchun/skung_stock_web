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
  useState,
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
  initial: { opacity: 0, scale: 0.3 },
  animate: () => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: Math.random() + 1.5,
      duration: 1.4,
      ease: cubicBezier(0.18, 0.71, 0.11, 1),
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

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const [isDragging, setIsDragging] = useState(false);
  const handleIsDragging = () => setIsDragging(true);
  const handleIsNotDragging = () => setIsDragging(false);

  useLayoutEffect(() => {
    if (!ref.current) return;

    const updateDimensions = () => {
      if (!ref.current) return;
      const { width, height } = ref.current.getBoundingClientRect();
      const wrapX = -(width / 2);
      const wrapY = -(height / 2);

      const xDrag = x.on("change", (latest) => {
        const wrappedX = wrap(wrapX, 0, latest);
        if (latest !== wrappedX) x.set(wrappedX);
      });

      const yDrag = y.on("change", (latest) => {
        const wrappedY = wrap(wrapY, 0, latest);
        if (latest !== wrappedY) y.set(wrappedY);
      });

      return () => {
        xDrag();
        yDrag();
      };
    };

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(ref.current);

    const initialCleanup = updateDimensions();

    const handleWheelScroll = (event: WheelEvent) => {
      if (!isDragging) {
        animate(y, y.get() - event.deltaY * 2, {
          type: "tween",
          duration: 0.8,
          ease: cubicBezier(0.18, 0.71, 0.11, 1),
        });
      }
    };

    window.addEventListener("wheel", handleWheelScroll, { passive: false });
    return () => {
      resizeObserver.disconnect();
      if (initialCleanup) initialCleanup();
      window.removeEventListener("wheel", handleWheelScroll);
    };
  }, [x, y, isDragging]);

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
            dragMomentum={true}
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
