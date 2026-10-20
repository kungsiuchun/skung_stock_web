import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, Upload, Sparkles, Loader2 } from "lucide-react";
import { parseJsonResponse } from "@/lib/safe-json-response";

interface AICaptionToolProps {
  isOpen: boolean;
  onClose: () => void;
}

const AICaptionTool = ({ isOpen, onClose }: AICaptionToolProps) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      requestRef.current?.abort();
      dialog?.close();
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!file) { setSelectedImage(null); return; }
    const url = URL.createObjectURL(file);
    setSelectedImage(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const resetImage = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setFile(null);
    setSelectedImage(null);
    setCaption(null);
    setError(null);
    setIsLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = e.target.files?.[0];
    if (!nextFile) return;
    resetImage();
    if (!["image/png", "image/jpeg"].includes(nextFile.type)) {
      setError("Choose a PNG or JPG image.");
    } else if (nextFile.size === 0 || nextFile.size > 5 * 1024 * 1024) {
      setError("Choose a non-empty image no larger than 5 MB.");
    } else setFile(nextFile);
  };

  const generateCaption = async () => {
    if (!file || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;

    setIsLoading(true);
    setCaption(null);
    setError(null);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/caption", {
        method: "POST",
        body: formData,
        signal: request.signal,
      });

      const data = await parseJsonResponse<{ result?: { description?: string; response?: string }; response?: string; description?: string }>(response, "/api/caption");

      const aiResponse = data && typeof data === "object"
        ? data.result?.description || data.result?.response || data.response || data.description
        : undefined;

      if (request.signal.aborted) return;
      if (typeof aiResponse === "string" && aiResponse.trim()) {
        setCaption(aiResponse);
      } else {
        throw new Error("The service returned no caption. Try again with a clearer image.");
      }
    } catch (error) {
      if (!request.signal.aborted) setError(error instanceof Error ? error.message : "Error connecting to AI service. Try again.");
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="caption-tool-title"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto overscroll-contain border-0 bg-transparent p-0 text-white backdrop:bg-black/80 backdrop:backdrop-blur-xl"
    >
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-[#1a1a1a] border border-white/10 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="px-8 py-6 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-3 text-white">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h2 id="caption-tool-title" className="font-bold uppercase tracking-[0.2em] text-sm">
                  AI Visual Guide
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close image caption tool"
                className="min-h-11 min-w-11 flex items-center justify-center hover:bg-white/5 rounded-full transition-colors text-white/50 hover:text-white focus-visible:ring-2 focus-visible:ring-purple-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-8">
              {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
              {!selectedImage ? (
                <button
                  type="button"
                  aria-label="Upload image for caption"
                  onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-white/10 rounded-2xl h-64 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-white/20 hover:bg-white/5 transition-colors group focus-visible:ring-2 focus-visible:ring-purple-400"
                >
                  <span className="p-4 bg-white/5 rounded-full group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-white/40 group-hover:text-white" />
                  </span>
                  <span className="text-center">
                    <span className="block text-white font-medium">Click to upload image</span>
                    <span className="block text-white/40 text-sm mt-1">PNG, JPG up to 5 MB</span>
                  </span>
                </button>
              ) : (
                <div className="space-y-6">
                  <div className="relative group rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 max-h-80 mx-auto w-fit">
                    <img
                      src={selectedImage}
                      alt="Upload preview"
                      onError={() => { resetImage(); setError("This image could not be opened. Choose a valid PNG or JPG."); }}
                      className="max-h-80 w-auto object-contain"
                    />
                    <button
                      onClick={resetImage}
                      aria-label="Remove uploaded image"
                      className="absolute top-4 right-4 min-h-11 min-w-11 flex items-center justify-center bg-black/60 backdrop-blur-md rounded-full text-white sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-purple-400 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div role="status" aria-live="polite" aria-busy={isLoading}>
                  <AnimatePresence mode="wait">
                    {caption ? (
                      <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white/5 border border-white/10 p-6 rounded-2xl"
                      >
                        <p className="text-white/60 text-xs font-mono uppercase tracking-widest mb-3 flex items-center gap-2">
                           <Sparkles className="w-3 h-3 text-purple-400" /> AI Generated Caption
                        </p>
                        <p className="text-xl text-white font-medium italic leading-relaxed">
                          "{caption}"
                        </p>
                      </motion.div>
                    ) : (
                      <button
                        onClick={generateCaption}
                        disabled={isLoading}
                className="w-full bg-white text-black py-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-[transform,background-color,color,opacity] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            ANALYZING IMAGE…
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            GENERATE CAPTION
                          </>
                        )}
                      </button>
                    )}
                  </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            <input
              type="file"
              name="caption-image"
              aria-label="Image for caption"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png,image/jpeg"
              className="hidden"
            />
          </motion.div>
    </dialog>
  );
};

export default AICaptionTool;
