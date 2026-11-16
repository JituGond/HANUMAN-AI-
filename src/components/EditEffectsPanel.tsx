import React, { useRef, useState } from 'react';
import { Sliders, Music, Wand2, Volume2, Square } from 'lucide-react';
import type {
  ColorGradePreset,
  EditRecommendations,
  EditSettings,
  MusicPreset,
  TransitionPreset,
  ZoomPreset,
} from '../types/studio';

interface EditEffectsPanelProps {
  settings: EditSettings;
  recommendations: EditRecommendations | null;
  hasVoiceover: boolean;
  onChange: (next: EditSettings) => void;
}

const TRANSITIONS: { id: TransitionPreset; label: string }[] = [
  { id: 'none', label: 'Hard Cut' },
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'flash', label: 'Flash Cut' },
  { id: 'fade', label: 'Smooth Fade' },
];

const ZOOMS: { id: ZoomPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'punch', label: 'Smart Punch-In' },
  { id: 'kenburns', label: 'Ken Burns' },
];

const GRADES: { id: ColorGradePreset; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'crisp', label: 'Crisp Studio' },
];

const MUSIC_TRACKS: { id: MusicPreset; label: string; mood: string }[] = [
  { id: 'none', label: 'No Music', mood: 'Silent' },
  { id: 'upbeat-tech', label: 'Upbeat Tech', mood: '120 BPM Synth' },
  { id: 'chill-ambient', label: 'Chill Ambient', mood: 'Warm Pad' },
  { id: 'cinematic-pulse', label: 'Cinematic Pulse', mood: 'Deep Score' },
  { id: 'gaming-synth', label: 'Gaming Synth', mood: '135 BPM Arcade' },
];

export const EditEffectsPanel: React.FC<EditEffectsPanelProps> = ({
  settings,
  recommendations,
  hasVoiceover,
  onChange,
}) => {
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [auditioning, setAuditioning] = useState<MusicPreset | null>(null);

  const applyAIRecommendations = () => {
    if (!recommendations) return;
    onChange({
      ...settings,
      transition: recommendations.transition,
      zoom: recommendations.zoom,
      colorGrade: recommendations.colorGrade,
      music: recommendations.music,
    });
  };

  const toggleAudition = async (preset: MusicPreset) => {
    if (preset === 'none') return;
    if (auditioning === preset) {
      previewAudioRef.current?.pause();
      setAuditioning(null);
      return;
    }
    setAuditioning(preset);
    if (previewAudioRef.current) {
      previewAudioRef.current.src = `/api/music/${preset}`;
      previewAudioRef.current.volume = 0.5;
      try {
        await previewAudioRef.current.play();
      } catch {
        setAuditioning(null);
      }
    }
  };

  return (
    <div className="space-y-5">
      {recommendations && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-300">AI Edit Suggestion</p>
            <p className="mt-1 text-xs text-slate-300 leading-relaxed">
              {recommendations.rationale}
            </p>
          </div>
          <button
            type="button"
            onClick={applyAIRecommendations}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Apply AI Style</span>
          </button>
        </div>
      )}

      {/* Visual Effects & Transitions */}
      <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="font-display text-base font-semibold text-white">
            Transitions, Zoom &amp; Color
          </h3>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Scene Transition</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TRANSITIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange({ ...settings, transition: t.id })}
                className={`rounded-lg px-3 py-2.5 text-xs font-medium border transition-colors min-h-[42px] whitespace-nowrap ${
                  settings.transition === t.id
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold'
                    : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Dynamic Zoom</p>
          <div className="grid grid-cols-3 gap-2">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => onChange({ ...settings, zoom: z.id })}
                className={`rounded-lg px-3 py-2.5 text-xs font-medium border transition-colors min-h-[42px] whitespace-nowrap ${
                  settings.zoom === z.id
                    ? 'border-sky-500 bg-sky-500/15 text-sky-300 font-semibold'
                    : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Color Grade</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onChange({ ...settings, colorGrade: g.id })}
                className={`rounded-lg px-3 py-2.5 text-xs font-medium border transition-colors min-h-[42px] whitespace-nowrap ${
                  settings.colorGrade === g.id
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold'
                    : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Background Music & Audio Mix */}
      <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-sky-400" />
          <h3 className="font-display text-base font-semibold text-white">
            Background Music &amp; Audio Mix
          </h3>
        </div>

        <audio
          ref={previewAudioRef}
          onEnded={() => setAuditioning(null)}
          className="hidden"
        />

        <div className="divide-y divide-slate-800/80">
          {MUSIC_TRACKS.map((track) => {
            const active = settings.music === track.id;
            return (
              <div
                key={track.id}
                className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
              >
                <button
                  type="button"
                  onClick={() => onChange({ ...settings, music: track.id })}
                  className="flex-1 text-left py-1.5 min-h-[40px] flex items-center justify-between gap-2"
                >
                  <div>
                    <span
                      className={`text-sm font-medium ${
                        active ? 'text-emerald-400 font-semibold' : 'text-slate-200'
                      }`}
                    >
                      {track.label}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">{track.mood}</span>
                  </div>
                  {active && (
                    <span className="text-xs font-semibold text-emerald-400">Selected</span>
                  )}
                </button>

                {track.id !== 'none' && (
                  <button
                    type="button"
                    onClick={() => toggleAudition(track.id)}
                    aria-label={auditioning === track.id ? 'Stop preview' : `Listen to ${track.label}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
                  >
                    {auditioning === track.id ? (
                      <Square className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Mix Sliders */}
        <div className="pt-4 border-t border-slate-800/80 space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300">Original Video Audio</span>
              <span className="font-mono tabular-nums text-slate-400">
                {Math.round(settings.originalAudioVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.originalAudioVolume}
              onChange={(e) =>
                onChange({ ...settings, originalAudioVolume: Number(e.target.value) })
              }
              className="studio-range w-full"
            />
          </div>

          {settings.music !== 'none' && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">Background Music</span>
                <span className="font-mono tabular-nums text-sky-400">
                  {Math.round(settings.musicVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.musicVolume}
                onChange={(e) =>
                  onChange({ ...settings, musicVolume: Number(e.target.value) })
                }
                className="studio-range w-full"
              />
            </div>
          )}

          {hasVoiceover && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">AI Voice-over</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {Math.round(settings.voiceoverVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.voiceoverVolume}
                onChange={(e) =>
                  onChange({ ...settings, voiceoverVolume: Number(e.target.value) })
                }
                className="studio-range w-full"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
