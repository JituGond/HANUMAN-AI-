import React, { useRef, useState } from 'react';
import { Upload, Film, Scissors, FileText, Mic, ArrowRight, Loader2 } from 'lucide-react';

interface UploadStageProps {
  onFileSelected: (file: File) => void;
  onLoadSample: () => void;
  onOpenVoiceStudio?: () => void;
  isUploading: boolean;
  uploadProgress: number;
  uploadStageLabel: string;
  error: string | null;
}

export const UploadStage: React.FC<UploadStageProps> = ({
  onFileSelected,
  onLoadSample,
  onOpenVoiceStudio,
  isUploading,
  uploadProgress,
  uploadStageLabel,
  error,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:py-14">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Primary Upload Canvas */}
        <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#0C1219] p-6 lg:p-8">
          <div>
            <p className="text-xs font-medium text-emerald-400 tracking-wide">
              Mobile &amp; Desktop Video Studio
            </p>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
              Edit videos, cut dead air, and generate voice-over scripts with AI
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Upload any clip up to 15 minutes long. Gemini watches the actual footage to spot boring pauses and mistakes, suggests smart cuts, writes scripts in 7 creator styles, and renders high-quality MP4 exports.
            </p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`mt-6 rounded-xl border border-dashed p-6 sm:p-8 text-center transition-colors ${
              isDragging
                ? 'border-emerald-400 bg-emerald-500/10'
                : 'border-slate-700 bg-[#070B10]/70 hover:border-slate-600'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileSelected(file);
                e.target.value = '';
              }}
            />

            {isUploading ? (
              <div className="py-4 space-y-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
                <div>
                  <p className="text-sm font-medium text-white">{uploadStageLabel}</p>
                  <p className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
                    {uploadProgress}% complete
                  </p>
                </div>
                <div className="mx-auto max-w-xs h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-200"
                    style={{ width: `${Math.max(4, uploadProgress)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-semibold text-white">
                    Tap to pick a video from your device or drop it here
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    MP4, MOV, WebM · Up to 15 minutes · Up to 750 MB
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors min-h-[44px]"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Select Video File</span>
                  </button>
                  <button
                    type="button"
                    onClick={onLoadSample}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 transition-colors min-h-[44px]"
                  >
                    <Film className="w-4 h-4 text-sky-400" />
                    <span>Try Sample Clip</span>
                  </button>
                  {onOpenVoiceStudio && (
                    <button
                      type="button"
                      onClick={onOpenVoiceStudio}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 transition-colors min-h-[44px]"
                    >
                      <Mic className="w-4 h-4 text-emerald-400" />
                      <span>Voice-over Studio</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-xs sm:text-sm text-rose-200">
              {error}
            </div>
          )}
        </div>

        {/* Right: Workflow Capability Breakdown */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#0C1219] p-6 lg:p-8">
          <div className="space-y-6">
            <h2 className="font-display text-lg font-semibold text-white">
              End-to-End AI Editing Pipeline
            </h2>

            <div className="space-y-5">
              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <Scissors className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    01. Smart Scene &amp; Mistake Detection
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Identifies highlights, silent dead air, and outtakes. Preview every suggested cut and approve or keep with one tap.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    02. Transitions, Zoom &amp; Music
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Applies smooth crossfades, dynamic punch-in zoom, color grading, and balanced background audio tracks.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    03. 7 Creator Script Styles
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Professional, Funny, Entertainment, Gaming Commentary, Storytelling, Informative, and YouTube Voice-over in Short, Medium, or Long formats.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    04. Multilingual AI Voice-over
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Synthesize up to 5,000 sentences in one click across 16 languages with natural male and female voices.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Android PWA Ready · 720p &amp; 1080p Export</span>
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              <span>Gemini 4 + FFmpeg</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
