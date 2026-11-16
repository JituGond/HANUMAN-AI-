import type { CutSuggestion } from '../types/studio';

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatShortTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatDurationVerbose(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (safe < 60) return `${safe.toFixed(1)}s`;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.round(safe % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/(?:[।॥.!?\u061F]+(?:\s+|$)|[\u3002\uFF01\uFF1F]+|\r?\n+)/);
  let count = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].trim().length > 0) count++;
  }
  return count;
}

export function computeKeptSummary(durationSec: number, cuts: CutSuggestion[]) {
  const approved = cuts
    .filter((c) => c.approved && c.endSec > c.startSec)
    .map((c) => ({
      startSec: Math.max(0, Math.min(durationSec, c.startSec)),
      endSec: Math.max(0, Math.min(durationSec, c.endSec)),
    }))
    .sort((a, b) => a.startSec - b.startSec);

  const merged: { startSec: number; endSec: number }[] = [];
  for (const c of approved) {
    if (merged.length === 0) {
      merged.push({ ...c });
    } else {
      const last = merged[merged.length - 1];
      if (c.startSec <= last.endSec + 0.05) {
        last.endSec = Math.max(last.endSec, c.endSec);
      } else {
        merged.push({ ...c });
      }
    }
  }

  const cutSec = merged.reduce((sum, c) => sum + (c.endSec - c.startSec), 0);
  const keptSec = Math.max(0.5, durationSec - cutSec);
  return {
    cutSec: Math.round(cutSec * 10) / 10,
    keptSec: Math.round(keptSec * 10) / 10,
    mergedCuts: merged,
  };
}
