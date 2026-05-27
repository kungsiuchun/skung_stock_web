import { portfolioConfig } from "@/config/portfolio";
import { 
  GridBody,
  DraggableContainer,
  GridItem, 
  } from "@/components/ui/infinite-drag-scroll";

// Keep the layout varied without making the infinite canvas feel unstable.
const getRandomOffset = (index: number) => {
  const seed = index * 12345;
  const r1 = Math.sin(seed) * 10000;
  const r2 = Math.cos(seed * 2) * 10000;
  const r3 = Math.sin(seed * 3) * 10000;
  const r4 = Math.cos(seed * 4) * 10000;
  
  return {
    marginTop: ((r1 - Math.floor(r1)) * 52 - 26),
    marginBottom: ((r2 - Math.floor(r2)) * 28 - 14),
    marginLeft: ((r3 - Math.floor(r3)) * 48 - 24),
    rotate: ((r4 - Math.floor(r4)) * 6 - 3),
    scale: 0.94 + (r1 - Math.floor(r1)) * 0.1,
    zIndex: Math.floor((r2 - Math.floor(r2)) * 50),
  };
};

const DemoOne = () => {
  return (
    <div className="w-full h-full min-h-screen overflow-hidden">
      <DraggableContainer variant="polaroid">
        <GridBody>
          {portfolioConfig.images.map((image, index) => {
            const offset = getRandomOffset(index);
            return (
              <div
                key={`${image.id}-${index}`}
                style={{
                  marginTop: `${offset.marginTop}px`,
                  marginBottom: `${offset.marginBottom}px`,
                  marginLeft: `${offset.marginLeft}px`,
                  transform: `rotate(${offset.rotate}deg) scale(${offset.scale})`,
                  zIndex: offset.zIndex,
                }}
                className="relative transition-transform duration-300 hover:scale-[1.04] hover:z-[100]"
              >
                <GridItem
                  className="relative h-60 w-44 md:h-96 md:w-64 shadow-2xl"
                >
                  <img
                    src={image.src}
                    alt={image.alt}
                    className="pointer-events-none absolute h-full w-full object-cover"
                  />
                </GridItem>
              </div>
            );
          })}
        </GridBody>
      </DraggableContainer>
    </div>
  );
};

export default DemoOne;
