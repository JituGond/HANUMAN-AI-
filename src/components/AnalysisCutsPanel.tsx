import React, { useState } from 'react';
import {
  Sparkles,
  Scissors,
  Check,
  X,
  Plus,
  Play,
  Loader2,
  Trash2,
  Undo2,
  AlertTriangle,
} from 'lucide-react';
import type { CutCategory, CutSuggestion, VideoAnalysis } from '../types/studio';
import { formatShortTime, formatTime } from '../utils/format';

interface AnalysisCutsPanelProps {
  durationSec: number;
  currentTime: number;
  analysis: VideoAnalysis | null;
  cuts: CutSuggestion[];
  canUndo: boolean;
  isAnalyzing: boolean;
  analyzeError: string | null;
  onRunAnalysis: () => void;
  onSetCutApproved: (id: string, approved: boolean) => void;
  onRemoveCut: (id: string) => void;
  onSetAllCuts: (approved: boolean) => void;
  onUndoCut: () => void;
  onAddManualCut: (startSec: number, endSec: number, category: CutCategory, reason: string) => void;
  onPreviewCut: (cut: CutSuggestion) => void;
  onSeekTo: (timeSec: number) => void;
}

const CATEGORY_LABEL: Record<CutCategory, string> = {
  boring: 'Boring Pause',
  silence: 'Silent Section',
  repeated: 'Repeated Scene',
  mistake: 'Mistake / Outtake',
  unnecessary: 'Unnecessary Footage',
  manual: 'Manual Trim',
};

export const AnalysisCutsPanel: React.FC<AnalysisCutsPanelProps> = ({
  durationSec,
  currentTime,
  analysis,
  cuts,
  canUndo,
  isAnalyzing,
  analyzeError,
  onRunAnalysis,
  onSetCutApproved,
  onRemoveCut,
  onSetAllCuts,
  onUndoCut,
  onAddManualCut,
  onPreviewCut,
  onSeekTo,
}) => {
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualStart, setManualStart] = useState(0);
  const [manualEnd, setManualEnd] = useState(2);
  const [manualCategory, setManualCategory] = useState<CutCategory>('manual');
  const [manualReason, setManualReason] = useState('Custom trim');

  const openManualForm = () => {
    const start = Math.round(currentTime * 10) / 10;
    const end = Math.min(durationSec, Math.round((start + 2) * 10) / 10);
    setManualStart(start);
    setManualEnd(end > start ? end : Math.min(durationSec, start + 0.5));
    setManualCategory('manual');
    setManualReason('Custom trim');
    setShowManualForm(true);
  };

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualEnd <= manualStart) return;
    onAddManualCut(
      manualStart,
      manualEnd,
      manualCategory,
      manualReason.trim() || 'Manual cut'
    );
    setShowManualForm(false);
  };

  const safeDuration = Math.max(0.5, durationSec);

  return (
    <div className="space-y-5">
      {/* AI Video Analysis Trigger Header */}
      <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              AI Video Analysis &amp; Auto-Cut
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-slate-400">
              Detects boring pauses, silence, repeated scenes, and filler while preserving key gameplay and audio.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunAnalysis}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-950 hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap min-h-[44px]"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analyzing Video...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{analysis ? 'Re-Analyze Video' : 'Analyze Video with AI'}</span>
              </>
            )}
          </button>
        </div>

        {analyzeError && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/50 p-3.5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-rose-200 leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{analyzeError}</span>
            </div>
            <button
              type="button"
              onClick={onRunAnalysis}
              disabled={isAnalyzing}
              className="shrink-0 rounded-md border border-rose-400/40 bg-rose-900/50 px-2.5 py-1 text-xs font-medium text-rose-100 hover:bg-rose-800/60 whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        )}

        {analysis && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2">
            <p className="text-sm text-slate-200 leading-relaxed">{analysis.summary}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sky-400">
              <span>{analysis.pacingNote}</span>
              {analysis.detectedTopics.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-slate-400">
                    {analysis.detectedTopics.join(' · ')}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Preserved Highlights & Gameplay Moments */}
      {analysis && analysis.highlights.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5">
          <h4 className="font-display text-sm font-semibold text-white">
            Preserved Key Moments ({analysis.highlights.length})
          </h4>
          <div className="mt-3 divide-y divide-slate-800/80">
            {analysis.highlights.map((hl) => (
              <button
                key={hl.id}
                type="button"
                onClick={() => onSeekTo(hl.startSec)}
                className="w-full py-3 first:pt-1 last:pb-1 flex items-start justify-between gap-3 text-left hover:bg-slate-800/30 rounded-lg px-2 -mx-2 transition-colors min-h-[44px]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{hl.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{hl.reason}</p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-sky-400 pt-0.5">
                  {formatTime(hl.startSec)} – {formatTime(hl.endSec)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested & Manual Cuts + Timestamp Timeline */}
      <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-emerald-400" />
            <h4 className="font-display text-sm font-semibold text-white">
              Suggested Cuts ({cuts.filter((c) => c.approved).length}/{cuts.length} approved)
            </h4>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onUndoCut}
              disabled={!canUndo}
              title="Undo last cut change"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed min-h-[34px]"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
            {cuts.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onSetAllCuts(true)}
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300 px-2 py-1"
                >
                  Approve All
                </button>
                <button
                  type="button"
                  onClick={() => onSetAllCuts(false)}
                  className="text-xs font-medium text-slate-400 hover:text-slate-200 px-2 py-1"
                >
                  Reject All
                </button>
              </>
            )}
            <button
              type="button"
              onClick={openManualForm}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 min-h-[34px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Cut</span>
            </button>
          </div>
        </div>

        {/* Dedicated Cut Timeline with Timestamps */}
        {cuts.length > 0 && (
          <div className="space-y-2 rounded-xl border border-slate-800/90 bg-[#070B10] p-3">
            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-400">
              <span>00:00</span>
              <span>{formatShortTime(safeDuration / 2)}</span>
              <span>{formatShortTime(safeDuration)}</span>
            </div>

            <div className="relative h-8 w-full rounded-md bg-slate-900/90 border border-slate-800 overflow-hidden">
              {/* Preserved Highlights markers */}
              {analysis?.highlights.map((hl) => {
                const left = (hl.startSec / safeDuration) * 100;
                const width = Math.max(1.2, ((hl.endSec - hl.startSec) / safeDuration) * 100);
                return (
                  <button
                    key={hl.id}
                    type="button"
                    onClick={() => onSeekTo(hl.startSec)}
                    title={`Preserved: ${hl.title} (${formatTime(hl.startSec)} – ${formatTime(hl.endSec)})`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="absolute top-0 h-2 bg-sky-400/85 hover:bg-sky-300 transition-colors"
                  />
                );
              })}

              {/* Suggested / Manual Cut markers */}
              {cuts.map((cut) => {
                const left = (cut.startSec / safeDuration) * 100;
                const width = Math.max(1.8, ((cut.endSec - cut.startSec) / safeDuration) * 100);
                return (
                  <button
                    key={cut.id}
                    type="button"
                    onClick={() => onPreviewCut(cut)}
                    title={`${CATEGORY_LABEL[cut.category]}: ${formatTime(cut.startSec)} – ${formatTime(cut.endSec)} (${cut.approved ? 'Approved Cut' : 'Rejected / Kept'})`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className={`absolute bottom-0 top-2 border-x transition-colors ${
                      cut.approved
                        ? 'bg-rose-500/55 border-rose-400 hover:bg-rose-500/75'
                        : 'bg-slate-700/45 border-slate-500 hover:bg-slate-600/60'
                    }`}
                  />
                );
              })}

              {/* Playhead */}
              <div
                style={{ left: `${Math.min(100, (currentTime / safeDuration) * 100)}%` }}
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-emerald-400"
              />
            </div>

            {/* Timestamp Quick-Jump Markers for Every Cut */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {cuts.map((cut, index) => (
                <button
                  key={cut.id}
                  type="button"
                  onClick={() => onPreviewCut(cut)}
                  className={`rounded border px-2 py-1 font-mono text-[11px] tabular-nums transition-colors ${
                    cut.approved
                      ? 'border-rose-500/40 bg-rose-950/35 text-rose-200 hover:bg-rose-950/60'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 line-through'
                  }`}
                >
                  #{index + 1} {formatTime(cut.startSec)}–{formatTime(cut.endSec)}
                </button>
              ))}
            </div>
          </div>
        )}

        {showManualForm && (
          <form
            onSubmit={handleSaveManual}
            className="rounded-xl border border-slate-700 bg-[#070B10] p-4 space-y-3"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block text-xs text-slate-400">
                Start (sec)
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={durationSec}
                  value={manualStart}
                  onChange={(e) => setManualStart(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0C1219] px-3 py-2 text-sm font-mono text-white"
                />
              </label>
              <label className="block text-xs text-slate-400">
                End (sec)
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={durationSec}
                  value={manualEnd}
                  onChange={(e) => setManualEnd(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0C1219] px-3 py-2 text-sm font-mono text-white"
                />
              </label>
              <label className="col-span-2 sm:col-span-1 block text-xs text-slate-400">
                Type
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as CutCategory)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0C1219] px-2.5 py-2 text-xs text-white"
                >
                  {(Object.keys(CATEGORY_LABEL) as CutCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABEL[cat]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs text-slate-400">
              Reason
              <input
                type="text"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0C1219] px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Save Cut
              </button>
            </div>
          </form>
        )}

        {cuts.length === 0 ? (
          <p className="text-xs sm:text-sm text-slate-400">
            {analysis
              ? 'No unwanted scenes detected—or add a manual trim above.'
              : 'Run AI Video Analysis to automatically detect boring pauses, silent sections, repeated scenes, and mistakes.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {cuts.map((cut) => (
              <div
                key={cut.id}
                className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono tabular-nums text-white font-semibold">
                      {formatTime(cut.startSec)} – {formatTime(cut.endSec)}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className={cut.approved ? 'text-rose-400 font-medium' : 'text-slate-400'}>
                      {CATEGORY_LABEL[cut.category]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300 leading-relaxed">{cut.reason}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onPreviewCut(cut)}
                    title="Preview this cut segment"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 hover:text-white hover:bg-slate-800 min-h-[38px]"
                  >
                    <Play className="w-3.5 h-3.5 text-sky-400" />
                    <span>Preview</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSetCutApproved(cut.id, true)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                      cut.approved
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                        : 'bg-slate-900 text-slate-400 border border-slate-700 hover:text-white'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSetCutApproved(cut.id, false)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                      !cut.approved
                        ? 'bg-slate-700 text-white border border-slate-500'
                        : 'bg-slate-900 text-slate-400 border border-slate-700 hover:text-white'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>

                  {cut.category === 'manual' && (
                    <button
                      type="button"
                      onClick={() => onRemoveCut(cut.id)}
                      aria-label="Delete manual cut"
                      className="p-2 text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
