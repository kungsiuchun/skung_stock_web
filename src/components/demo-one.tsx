import { portfolioConfig } from "@/config/portfolio";
import { 
  GridBody,
  DraggableContainer,
  GridItem, 
  } from "@/components/ui/infinite-drag-scroll";

// Generate random offset for each image index with more jitter
const getRandomOffset = (index: number) => {
  const seed = index * 12345;
  const r1 = Math.sin(seed) * 10000;
  const r2 = Math.cos(seed * 2) * 10000;
  const r3 = Math.sin(seed * 3) * 10000;
  const r4 = Math.cos(seed * 4) * 10000;
  
  return {
    marginTop: ((r1 - Math.floor(r1)) * 120 - 60),
    marginBottom: ((r2 - Math.floor(r2)) * 60 - 30),
    marginLeft: ((r3 - Math.floor(r3)) * 100 - 50),
    rotate: ((r4 - Math.floor(r4)) * 16 - 8), // -8 to 8 degrees
    scale: 0.85 + (r1 - Math.floor(r1)) * 0.25, // 0.85 to 1.1
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
                className="relative transition-all duration-500 hover:scale-110 hover:z-[100]"
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
