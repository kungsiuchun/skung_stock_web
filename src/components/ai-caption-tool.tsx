import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Upload, Sparkles, Loader2 } from "lucide-react";

interface AICaptionToolProps {
  isOpen: boolean;
  onClose: () => void;
}

const AICaptionTool = ({ isOpen, onClose }: AICaptionToolProps) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setCaption(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateCaption = async () => {
    if (!file) return;

    setIsLoading(true);
    setCaption(null);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/caption", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      console.log("AI API Response:", data);

      const aiResponse = data.result?.description || data.result?.response || data.response || data.description;

      if (aiResponse) {
        setCaption(aiResponse);
      } else {
        console.warn("Unexpected AI response format:", data);
        setCaption("AI couldn't generate a caption. Use a clearer image!");
      }
    } catch (error) {
      console.error("AI captioning failed:", error);
      setCaption("Error connecting to AI service.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-[#1a1a1a] border border-white/10 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="px-8 py-6 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-3 text-white">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h2 className="text-xl font-bold tracking-tight uppercase tracking-[0.2em] text-sm">
                  AI Visual Guide
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/50 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-8">
              {!selectedImage ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-2xl h-64 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-white/20 hover:bg-white/5 transition-all group"
                >
                  <div className="p-4 bg-white/5 rounded-full group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-white/40 group-hover:text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">Click to upload image</p>
                    <p className="text-white/40 text-sm mt-1">PNG, JPG up to 5MB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="relative group rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 max-h-80 mx-auto w-fit">
                    <img
                      src={selectedImage}
                      alt="Upload preview"
                      className="max-h-80 w-auto object-contain"
                    />
                    <button
                      onClick={() => { setSelectedImage(null); setFile(null); setCaption(null); }}
                      className="absolute top-4 right-4 p-2 bg-black/60 backdrop-blur-md rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {caption ? (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
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
                        className="w-full bg-white text-black py-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            ANALYZING IMAGE...
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
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default AICaptionTool;
