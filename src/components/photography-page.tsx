import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, X } from "lucide-react";
import { portfolioConfig } from "@/config/portfolio";
import { PortfolioFooter } from "./portfolio-footer";

// Only Siu's local photographs belong in the personal photo journal.
const photographs = portfolioConfig.images.filter((photo) =>
  photo.src.startsWith("/image/"),
);
const sequence = [32, 37, 31, 34, 29, 38, 39, 40, 30, 33, 28, 35, 36];
const orderedPhotos = [...photographs].sort((a, b) => {
  const rank = (id: number) =>
    sequence.includes(id) ? sequence.indexOf(id) : sequence.length;
  return rank(a.id) - rank(b.id);
});
const photoCaption = (alt: string) =>
  alt
    .replace("Uploaded photo ", "Travel journal · Frame ")
    .replace(" with umbrella removed", "");

export default function PhotographyPage() {
  const [filter, setFilter] = useState("All photographs");
  const [active, setActive] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const photos = orderedPhotos.filter(
    (photo) =>
      filter === "All photographs" ||
      (filter === "City studies"
        ? /Chicago|Navy Pier|Wrigley|Hong Kong/.test(photo.alt)
        : !/Chicago|Navy Pier|Wrigley|Hong Kong/.test(photo.alt)),
  );
  const selected = active === null ? null : photos[active];
  const isOpen = active !== null;
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      openerRef.current?.focus({ preventScroll: true });
    };
  }, [isOpen]);
  useEffect(() => {
    setImageError(false);
  }, [active]);
  const move = (step: number) =>
    setActive((index) =>
      index === null ? null : (index + step + photos.length) % photos.length,
    );

  return (
    <>
      <div className="portfolio-wrap">
        <header className="page-heading photo-heading">
          <p className="eyebrow">02 / THE PHOTO JOURNAL</p>
          <h1>
            Somewhere,
            <br />
            <em>worth a second look.</em>
          </h1>
          <div className="heading-bottom">
            <p>
              Travel, people, and the small things along the way.
              <br />A collection of photographs from my time away from the
              screen.
            </p>
            <span className="photo-count">
              {photographs.length} FRAMES / NIKON D3500
            </span>
          </div>
        </header>
        <div
          className="filter-bar"
          role="group"
          aria-label="Filter photographs"
        >
          {["All photographs", "City studies", "Travel moments"].map(
            (value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {photos.length} photographs shown
        </p>
        <div className="gallery-grid">
          {photos.map((photo, index) => (
            <figure key={photo.id}>
              <button
                type="button"
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setActive(index);
                }}
                aria-label={`View photograph: ${photoCaption(photo.alt)}`}
              >
                <img
                  src={photo.src}
                  alt={photoCaption(photo.alt)}
                  loading={index < 2 ? "eager" : "lazy"}
                  decoding="async"
                />
                <figcaption>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{photoCaption(photo.alt)}</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </figcaption>
              </button>
            </figure>
          ))}
        </div>
      </div>
      <PortfolioFooter />
      <dialog
        ref={dialogRef}
        className="photo-dialog"
        aria-label="Photograph viewer"
        onCancel={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {selected && (
          <div className="lightbox-inner">
            <div className="lightbox-toolbar">
              <span>
                SIU / PHOTO JOURNAL · {Number(active) + 1} OF {photos.length}
              </span>
              <button
                type="button"
                onClick={() => setActive(null)}
                aria-label="Close photograph"
              >
                <X size={18} />
              </button>
            </div>
            {imageError ? (
              <p role="alert">
                This photograph could not load.{" "}
                <a href={selected.src}>Open the image file</a>.
              </p>
            ) : (
              <img
                className="lightbox-photo"
                src={selected.src}
                alt={photoCaption(selected.alt)}
                onError={() => setImageError(true)}
              />
            )}
            <div className="lightbox-caption">
              <div aria-live="polite">
                <p>{photoCaption(selected.alt)}</p>
              </div>
              <p className="lightbox-help">← → to explore · Esc to close</p>
              <div>
                <button
                  type="button"
                  aria-label="Previous photograph"
                  onClick={() => move(-1)}
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Next photograph"
                  onClick={() => move(1)}
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
