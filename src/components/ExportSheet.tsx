import React from 'react';
import { Download, Loader2, Film, CheckCircle2 } from 'lucide-react';
import type {
  CutSuggestion,
  EditSettings,
  ExportResult,
  VideoProject,
  VoiceoverResult,
} from '../types/studio';
import { computeKeptSummary, formatBytes, formatTime } from '../utils/format';

interface ExportSheetProps {
  project: VideoProject;
  cuts: CutSuggestion[];
  settings: EditSettings;
  voiceover: VoiceoverResult | null;
  includeVoiceover: boolean;
  onToggleIncludeVoiceover: (val: boolean) => void;
  onChangeQuality: (q: '720p' | '1080p') => void;
  isExporting: boolean;
  exportError: string | null;
  exportResult: ExportResult | null;
  onStartExport: () => void;
}

export const ExportSheet: React.FC<ExportSheetProps> = ({
  project,
  cuts,
  settings,
  voiceover,
  includeVoiceover,
  onToggleIncludeVoiceover,
  onChangeQuality,
  isExporting,
  exportError,
  exportResult,
  onStartExport,
}) => {
  const { cutSec, keptSec } = computeKeptSummary(project.metadata.durationSec, cuts);
  const approvedCount = cuts.filter((c) => c.approved).length;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 lg:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Film className="w-4 h-4 text-emerald-400" />
        <h3 className="font-display text-base font-semibold text-white">
          Render &amp; Download Final Video
        </h3>
      </div>

      {/* Render Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-800 bg-[#070B10] p-4">
        <div>
          <p className="text-xs text-slate-400">Original</p>
          <p className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
            {formatTime(project.metadata.durationSec)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Final Edited</p>
          <p className="mt-1 font-mono text-sm font-semibold text-emerald-400 tabular-nums">
            {formatTime(keptSec)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Cuts Applied</p>
          <p className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
            {approvedCount} ({cutSec.toFixed(1)}s)
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Visual Style</p>
          <p className="mt-1 text-sm font-semibold text-sky-400 capitalize truncate">
            {settings.colorGrade} · {settings.transition}
          </p>
        </div>
      </div>

      {/* Quality & Voiceover Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Export Resolution</p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#070B10] p-1 border border-slate-800">
            {(['720p', '1080p'] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onChangeQuality(q)}
                className={`py-2 text-xs font-medium rounded-md transition-colors min-h-[38px] ${
                  settings.exportQuality === q
                    ? 'bg-emerald-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {q === '1080p' ? '1080p Full HD' : '720p HD (Fast)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">AI Voice-over Track</p>
          <button
            type="button"
            disabled={!voiceover}
            onClick={() => onToggleIncludeVoiceover(!includeVoiceover)}
            className={`w-full rounded-lg border px-3.5 py-2.5 text-xs font-medium text-left transition-colors min-h-[44px] ${
              !voiceover
                ? 'border-slate-800 bg-[#070B10] text-slate-500 cursor-not-allowed'
                : includeVoiceover
                  ? 'border-sky-500 bg-sky-500/15 text-sky-300 font-semibold'
                  : 'border-slate-700 bg-[#070B10] text-slate-300'
            }`}
          >
            {!voiceover
              ? 'No AI voice-over generated yet'
              : includeVoiceover
                ? `Included (${voiceover.voiceId} · Mixed at ${Math.round(settings.voiceoverVolume * 100)}%)`
                : 'Excluded from export (tap to include)'}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3.5 py-3 text-xs text-rose-200">
          {exportError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStartExport}
          disabled={isExporting}
          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:opacity-90 disabled:opacity-60 transition-opacity min-h-[48px]"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Rendering High-Quality MP4...</span>
            </>
          ) : (
            <>
              <Film className="w-4 h-4" />
              <span>Render Final MP4</span>
            </>
          )}
        </button>

        {exportResult && (
          <a
            href={exportResult.downloadUrl}
            download={exportResult.filename}
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-5 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-colors min-h-[48px]"
          >
            <Download className="w-4 h-4" />
            <span>Download ({formatBytes(exportResult.sizeBytes)})</span>
          </a>
        )}
      </div>

      {exportResult && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-white">{exportResult.filename}</p>
            <p className="font-mono tabular-nums text-slate-400">
              {exportResult.editedDurationSec.toFixed(1)}s · {exportResult.cutsApplied} cuts applied ·{' '}
              {formatBytes(exportResult.sizeBytes)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
