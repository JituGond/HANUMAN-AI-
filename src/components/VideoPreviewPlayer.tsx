import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Replace,
} from 'lucide-react';
import type {
  CutSuggestion,
  EditSettings,
  HighlightSegment,
  VideoProject,
  VoiceoverResult,
} from '../types/studio';
import { computeKeptSummary, formatBytes, formatTime } from '../utils/format';

interface VideoPreviewPlayerProps {
  project: VideoProject;
  cuts: CutSuggestion[];
  highlights: HighlightSegment[];
  settings: EditSettings;
  voiceover: VoiceoverResult | null;
  currentTime: number;
  onTimeChange: (timeSec: number) => void;
  seekTrigger: { timeSec: number; nonce: number } | null;
  auditionCut?: { startSec: number; endSec: number; reason?: string; nonce: number } | null;
  onClearAudition?: () => void;
  onChangeVideo: () => void;
}

export const VideoPreviewPlayer: React.FC<VideoPreviewPlayerProps> = ({
  project,
  cuts,
  highlights,
  settings,
  voiceover,
  currentTime,
  onTimeChange,
  seekTrigger,
  auditionCut,
  onClearAudition,
  onChangeVideo,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [previewEdited, setPreviewEdited] = useState(true);
  const [muted, setMuted] = useState(false);
  const [transitionFlash, setTransitionFlash] = useState(false);

  const duration = project.metadata.durationSec;
  const keptSummary = useMemo(() => computeKeptSummary(duration, cuts), [duration, cuts]);

  const rawToEditedTime = (rawSec: number) => {
    let subtracted = 0;
    for (const c of keptSummary.mergedCuts) {
      if (rawSec >= c.endSec) {
        subtracted += c.endSec - c.startSec;
      } else if (rawSec > c.startSec) {
        subtracted += rawSec - c.startSec;
        break;
      } else {
        break;
      }
    }
    return Math.max(0, rawSec - subtracted);
  };

  const syncVoicePosition = (rawSec: number) => {
    const va = voiceAudioRef.current;
    if (!va) return;
    const editedSec = previewEdited ? rawToEditedTime(rawSec) : rawSec;
    const maxDur = Number.isFinite(va.duration) && va.duration > 0 ? va.duration : Infinity;
    va.currentTime = Math.max(0, Math.min(maxDur, editedSec));
  };

  const seekAllTo = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(duration, targetSec));
    onClearAudition?.();
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
    syncVoicePosition(clamped);
    onTimeChange(clamped);
  };

  // Apply external seek requests (e.g., clicking a highlight or timeline point)
  useEffect(() => {
    if (!seekTrigger || !videoRef.current) return;
    onClearAudition?.();
    const clamped = Math.max(0, Math.min(duration, seekTrigger.timeSec));
    videoRef.current.currentTime = clamped;
    onTimeChange(clamped);
    syncVoicePosition(clamped);
  }, [seekTrigger]);

  // Audition a specific cut segment [startSec, endSec] without auto-skipping it
  useEffect(() => {
    if (!auditionCut || !videoRef.current) return;
    const v = videoRef.current;
    v.currentTime = auditionCut.startSec;
    onTimeChange(auditionCut.startSec);
    voiceAudioRef.current?.pause();
    musicAudioRef.current?.pause();
    v.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, [auditionCut]);

  // Keep audio element volumes synchronized
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = muted ? 0 : settings.originalAudioVolume;
      videoRef.current.muted = muted;
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.volume = muted ? 0 : settings.musicVolume;
    }
    if (voiceAudioRef.current) {
      voiceAudioRef.current.volume = muted ? 0 : settings.voiceoverVolume;
    }
  }, [
    muted,
    settings.originalAudioVolume,
    settings.musicVolume,
    settings.voiceoverVolume,
  ]);

  // Sync play/pause for music & voiceover (pause aux tracks during cut auditioning)
  useEffect(() => {
    const syncAux = async () => {
      if (isPlaying && previewEdited && !auditionCut) {
        if (musicAudioRef.current && settings.music !== 'none') {
          try {
            await musicAudioRef.current.play();
          } catch {
            // Autoplay blocked until user interaction
          }
        }
        if (voiceAudioRef.current && voiceover) {
          const va = voiceAudioRef.current;
          const editedSec = rawToEditedTime(videoRef.current?.currentTime ?? currentTime);
          if (Math.abs((va.currentTime || 0) - editedSec) > 0.35) {
            syncVoicePosition(videoRef.current?.currentTime ?? currentTime);
          }
          if (!Number.isFinite(va.duration) || editedSec < va.duration - 0.05) {
            try {
              await va.play();
            } catch {
              // Ignore
            }
          }
        }
      } else {
        musicAudioRef.current?.pause();
        voiceAudioRef.current?.pause();
      }
    };
    syncAux();
  }, [isPlaying, previewEdited, auditionCut, settings.music, voiceover]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    onTimeChange(t);

    // If auditioning a specific cut segment, play up to endSec cleanly then pause
    if (auditionCut) {
      if (t >= auditionCut.endSec) {
        v.pause();
        setIsPlaying(false);
        onClearAudition?.();
      }
      return;
    }

    if (previewEdited) {
      const hitCut = keptSummary.mergedCuts.find(
        (c) => t >= c.startSec && t < c.endSec - 0.08
      );
      if (hitCut) {
        if (settings.transition !== 'none') {
          setTransitionFlash(true);
          setTimeout(() => setTransitionFlash(false), 300);
        }
        if (hitCut.endSec >= duration - 0.15) {
          v.pause();
          v.currentTime = 0;
          syncVoicePosition(0);
          if (musicAudioRef.current) musicAudioRef.current.currentTime = 0;
          setIsPlaying(false);
        } else {
          v.currentTime = hitCut.endSec;
        }
      }
    }
  };

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended) {
        v.currentTime = 0;
        syncVoicePosition(0);
        if (musicAudioRef.current) musicAudioRef.current.currentTime = 0;
      } else if (previewEdited && !auditionCut) {
        const hitCut = keptSummary.mergedCuts.find(
          (c) => v.currentTime >= c.startSec && v.currentTime < c.endSec - 0.08
        );
        if (hitCut) {
          v.currentTime = hitCut.endSec >= duration - 0.15 ? 0 : hitCut.endSec;
          syncVoicePosition(v.currentTime);
        }
      }
      await v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
      if (auditionCut) onClearAudition?.();
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekAllTo(Number(e.target.value));
  };

  // Visual preview filter & zoom math
  const videoFilterStyle = useMemo(() => {
    if (!previewEdited) return 'none';
    switch (settings.colorGrade) {
      case 'cinematic':
        return 'contrast(1.08) saturate(1.16) brightness(1.01)';
      case 'vibrant':
        return 'contrast(1.06) saturate(1.32) brightness(1.02)';
      case 'crisp':
        return 'contrast(1.12) saturate(1.08) brightness(1.02)';
      default:
        return 'none';
    }
  }, [previewEdited, settings.colorGrade]);

  const isInsideHighlight = useMemo(
    () => highlights.some((h) => currentTime >= h.startSec && currentTime <= h.endSec),
    [highlights, currentTime]
  );

  const zoomScale = useMemo(() => {
    if (!previewEdited || settings.zoom === 'off') return 1;
    if (settings.zoom === 'punch') return isInsideHighlight ? 1.09 : 1;
    // kenburns subtle continuous breathing
    return 1.02 + 0.05 * Math.abs(Math.sin(currentTime * 0.4));
  }, [previewEdited, settings.zoom, isInsideHighlight, currentTime]);

  const isCurrentlyInCut = useMemo(
    () =>
      keptSummary.mergedCuts.some(
        (c) => currentTime >= c.startSec && currentTime <= c.endSec
      ),
    [keptSummary.mergedCuts, currentTime]
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0C1219] overflow-hidden">
      {/* Top Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white truncate max-w-[260px] sm:max-w-sm">
            {project.originalName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums">
            {formatTime(duration)} · {project.metadata.width}×{project.metadata.height} ·{' '}
            {project.metadata.fps} fps · {formatBytes(project.metadata.sizeBytes)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center rounded-lg bg-[#070B10] p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setPreviewEdited(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                previewEdited
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Edited Preview
            </button>
            <button
              type="button"
              onClick={() => setPreviewEdited(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                !previewEdited
                  ? 'bg-slate-800 text-white font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Original
            </button>
          </div>

          <button
            type="button"
            onClick={onChangeVideo}
            title="Upload another video"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap min-h-[36px]"
          >
            <Replace className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Clip</span>
          </button>
        </div>
      </div>

      {/* Video Stage */}
      <div className="relative bg-black aspect-video flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={project.videoUrl}
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            musicAudioRef.current?.pause();
            voiceAudioRef.current?.pause();
          }}
          onClick={togglePlay}
          style={{
            filter: videoFilterStyle,
            transform: `scale(${zoomScale.toFixed(3)})`,
            transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease',
          }}
          className="h-full w-full object-contain cursor-pointer"
        />

        {/* Transition flash / smooth dissolve overlay */}
        {transitionFlash && (
          <div
            className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
              settings.transition === 'flash'
                ? 'bg-white/65'
                : settings.transition === 'crossfade'
                  ? 'bg-slate-950/55'
                  : 'bg-black/80'
            }`}
          />
        )}

        {/* Active Cut Audition Banner */}
        {auditionCut && (
          <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-amber-950/90 border border-amber-500/50 px-2.5 py-1 text-xs font-medium text-amber-200 font-mono tabular-nums">
            Previewing Cut: {formatTime(auditionCut.startSec)} – {formatTime(auditionCut.endSec)}
          </div>
        )}

        {/* Original mode cut indicator */}
        {!auditionCut && !previewEdited && isCurrentlyInCut && (
          <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-rose-950/90 border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-200">
            Marked for Cut
          </div>
        )}

        {/* Hidden synchronized audio tracks for live preview */}
        {settings.music !== 'none' && (
          <audio
            ref={musicAudioRef}
            src={`/api/music/${settings.music}`}
            loop
            preload="auto"
          />
        )}
        {voiceover && (
          <audio ref={voiceAudioRef} src={voiceover.audioUrl} preload="auto" />
        )}
      </div>

      {/* Playback Controls + Timeline Scrubber */}
      <div className="p-4 space-y-3 bg-[#0C1219]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => seekAllTo(currentTime - 5)}
              aria-label="Back 5 seconds"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => seekAllTo(currentTime + 5)}
              aria-label="Forward 5 seconds"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-right font-mono text-xs tabular-nums">
            <span className="text-white">{formatTime(currentTime)}</span>
            <span className="text-slate-500"> / {formatTime(duration)}</span>
            <span className="hidden sm:inline text-emerald-400 ml-3">
              Edited: {formatTime(keptSummary.keptSec)}
            </span>
          </div>
        </div>

        {/* Visual Frame Strip + Cut/Highlight Overlay Timeline */}
        <div className="relative select-none">
          <div className="relative h-12 rounded-lg overflow-hidden border border-slate-800 bg-[#070B10] flex">
            {project.thumbnails.length > 0 ? (
              project.thumbnails.map((src, i) => (
                <img
                  key={src + i}
                  src={src}
                  alt=""
                  className="h-full flex-1 object-cover opacity-75 pointer-events-none"
                  referrerPolicy="no-referrer"
                />
              ))
            ) : (
              <div className="w-full h-full bg-slate-900" />
            )}

            {/* Highlight overlays */}
            {highlights.map((hl) => {
              const left = (hl.startSec / duration) * 100;
              const width = Math.max(1, ((hl.endSec - hl.startSec) / duration) * 100);
              return (
                <div
                  key={hl.id}
                  title={`Highlight: ${hl.title}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className="pointer-events-none absolute top-0 h-1.5 bg-sky-400"
                />
              );
            })}

            {/* Approved cut overlays */}
            {cuts
              .filter((c) => c.approved)
              .map((cut) => {
                const left = (cut.startSec / duration) * 100;
                const width = Math.max(1, ((cut.endSec - cut.startSec) / duration) * 100);
                return (
                  <div
                    key={cut.id}
                    title={`Cut: ${cut.reason}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="pointer-events-none absolute inset-y-0 bg-rose-500/45 border-x border-rose-400/80"
                  />
                );
              })}

            {/* Playhead */}
            <div
              style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]"
            />
          </div>

          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={currentTime}
            onChange={handleScrub}
            aria-label="Seek timeline"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>

        {/* Timeline legend (unboxed inline text) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-xs bg-sky-400 inline-block" />
              <span>AI Highlight</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-xs bg-rose-500/70 inline-block" />
              <span>Approved Cut</span>
            </span>
          </div>
          <span className="font-mono tabular-nums text-slate-300">
            Removed: {keptSummary.cutSec.toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
};
