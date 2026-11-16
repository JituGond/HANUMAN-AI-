import React, { useMemo, useRef, useState } from 'react';
import {
  FileText,
  Mic,
  Loader2,
  Copy,
  Check,
  Volume2,
  Download,
  Upload,
  Globe,
  Trash2,
} from 'lucide-react';
import {
  MAX_VOICEOVER_SENTENCES,
  SCRIPT_STYLES,
  VOICE_LANGUAGES,
  VOICE_OPTIONS,
  type GeneratedScript,
  type ScriptLanguage,
  type ScriptLength,
  type ScriptStyle,
  type VoiceId,
  type VoiceoverJobProgress,
  type VoiceoverResult,
} from '../types/studio';
import {
  countSentences,
  formatBytes,
  formatDurationVerbose,
  formatShortTime,
} from '../utils/format';

interface ScriptVoicePanelProps {
  hasProject: boolean;
  onTriggerUploadVideo?: () => void;
  script: GeneratedScript | null;
  editedScriptText: string;
  onChangeEditedScriptText: (text: string) => void;
  style: ScriptStyle;
  length: ScriptLength;
  language: ScriptLanguage;
  onChangeStyle: (s: ScriptStyle) => void;
  onChangeLength: (l: ScriptLength) => void;
  onChangeLanguage: (lang: ScriptLanguage) => void;
  isGeneratingScript: boolean;
  scriptError: string | null;
  onGenerateScript: () => void;
  selectedVoice: VoiceId;
  onChangeVoice: (v: VoiceId) => void;
  voiceover: VoiceoverResult | null;
  voiceoverProgress: VoiceoverJobProgress | null;
  isGeneratingVoiceover: boolean;
  voiceoverError: string | null;
  onGenerateVoiceover: () => void;
  onSeekTo: (sec: number) => void;
}

export const ScriptVoicePanel: React.FC<ScriptVoicePanelProps> = ({
  hasProject,
  onTriggerUploadVideo,
  script,
  editedScriptText,
  onChangeEditedScriptText,
  style,
  length,
  language,
  onChangeStyle,
  onChangeLength,
  onChangeLanguage,
  isGeneratingScript,
  scriptError,
  onGenerateScript,
  selectedVoice,
  onChangeVoice,
  voiceover,
  voiceoverProgress,
  isGeneratingVoiceover,
  voiceoverError,
  onGenerateVoiceover,
  onSeekTo,
}) => {
  const [copied, setCopied] = useState(false);
  const txtInputRef = useRef<HTMLInputElement | null>(null);

  const sentenceCount = useMemo(
    () => countSentences(editedScriptText),
    [editedScriptText]
  );
  const utf8Bytes = useMemo(
    () => new TextEncoder().encode(editedScriptText).length,
    [editedScriptText]
  );
  const exceedsSentenceLimit = sentenceCount > MAX_VOICEOVER_SENTENCES;

  const handleCopy = async () => {
    if (!editedScriptText) return;
    await navigator.clipboard.writeText(editedScriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleImportTxt = async (file: File) => {
    const content = await file.text();
    onChangeEditedScriptText(content);
  };

  const downloadAudioUrl = voiceover
    ? `${voiceover.audioUrl}${voiceover.audioUrl.includes('?') ? '&' : '?'}download=1`
    : '';

  const activeLanguageObj =
    VOICE_LANGUAGES.find((l) => l.id === language) || VOICE_LANGUAGES[0];

  return (
    <div className="space-y-5">
      {/* AI Script Generator from Video (when video is loaded, or compact prompt to load video) */}
      {hasProject ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <h3 className="font-display text-base font-semibold text-white">
                  AI Script Generator
                </h3>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Writes an editable script from your uploaded video content.
              </p>
            </div>

            <button
              type="button"
              onClick={onGenerateScript}
              disabled={isGeneratingScript}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 transition-colors whitespace-nowrap min-h-[44px]"
            >
              {isGeneratingScript ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Writing Script...</span>
                </>
              ) : (
                <span>{script ? 'Regenerate Script' : 'Generate Script'}</span>
              )}
            </button>
          </div>

          {/* Language & Length Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="script-lang-select"
                className="block text-xs font-medium text-slate-400 mb-2"
              >
                Script Language
              </label>
              <select
                id="script-lang-select"
                value={language === 'auto' ? 'en' : language}
                onChange={(e) => onChangeLanguage(e.target.value as ScriptLanguage)}
                className="w-full rounded-lg border border-slate-800 bg-[#070B10] px-3 py-2.5 text-xs font-medium text-white focus:border-sky-500 focus:outline-none min-h-[42px]"
              >
                {VOICE_LANGUAGES.filter((l) => l.supportsScriptGen).map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label} ({lang.nativeLabel})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Script Length</p>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#070B10] p-1 border border-slate-800">
                {(['short', 'medium', 'long'] as ScriptLength[]).map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => onChangeLength(len)}
                    className={`py-2 text-xs font-medium capitalize rounded-md transition-colors min-h-[38px] ${
                      length === len
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 7 Script Styles */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">Script Style (7 Options)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SCRIPT_STYLES.map((item) => {
                const active = style === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeStyle(item.id)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors min-h-[44px] ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/15 text-white'
                        : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="block text-xs font-semibold truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {scriptError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2.5 text-xs text-rose-200">
              {scriptError}
            </div>
          )}

          {/* Scene-synced jump cues when generated */}
          {script && script.sections.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-300 truncate">
                {script.title} — Scene Cues
              </h4>
              <div className="flex flex-wrap gap-2">
                {script.sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => onSeekTo(sec.startSec)}
                    className="rounded-md border border-slate-800 bg-[#070B10] px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-500/50 hover:text-white transition-colors"
                  >
                    <span className="font-mono text-sky-400 mr-1.5">
                      {formatShortTime(sec.startSec)}
                    </span>
                    <span>{sec.heading}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              Multilingual Batch Voice-over Studio
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Paste or import up to 5,000 sentences in any supported language and generate clear, natural voice audio in one click.
            </p>
          </div>
          {onTriggerUploadVideo && (
            <button
              type="button"
              onClick={onTriggerUploadVideo}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap min-h-[40px]"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Attach to Video</span>
            </button>
          )}
        </div>
      )}

      {/* Script Input + AI Voice-over Generator (Always accessible for 1-click up to 5,000 sentences) */}
      <div className="rounded-2xl border border-slate-800 bg-[#0C1219] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-sky-400" />
              <h3 className="font-display text-base font-semibold text-white">
                AI Voice-over Generator
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Fast parallel synthesis for up to 5,000 sentences · Natural voices in 16 languages.
            </p>
          </div>

          <button
            type="button"
            onClick={onGenerateVoiceover}
            disabled={isGeneratingVoiceover || !editedScriptText.trim() || exceedsSentenceLimit}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap min-h-[44px]"
          >
            {isGeneratingVoiceover ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {voiceoverProgress
                    ? `Synthesizing (${voiceoverProgress.percent}%)...`
                    : 'Synthesizing Voice...'}
                </span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4" />
                <span>{voiceover ? 'Regenerate Voice' : 'Generate AI Voice'}</span>
              </>
            )}
          </button>
        </div>

        {/* Narration Script Editor (Paste or Import .txt up to 5,000 sentences) */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="narration-script-textarea"
              className="text-xs font-medium text-slate-300"
            >
              Narration Script
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={txtInputRef}
                type="file"
                accept=".txt,.srt,.md,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportTxt(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => txtInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-md hover:bg-slate-800/70 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import .txt</span>
              </button>
              {editedScriptText && (
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 px-2 py-1 rounded-md hover:bg-slate-800/70 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeEditedScriptText('')}
                    title="Clear script"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-400 px-2 py-1 rounded-md hover:bg-slate-800/70 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <textarea
            id="narration-script-textarea"
            rows={hasProject ? 7 : 10}
            value={editedScriptText}
            onChange={(e) => onChangeEditedScriptText(e.target.value)}
            placeholder="Paste or type up to 5,000 sentences here in English, Hindi, Spanish, French, Japanese, Arabic, or any supported language..."
            className="w-full rounded-xl border border-slate-700 bg-[#070B10] p-3.5 text-sm text-slate-100 leading-relaxed focus:border-emerald-500 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <span
              className={
                exceedsSentenceLimit
                  ? 'text-rose-400 font-semibold'
                  : sentenceCount > 4500
                    ? 'text-amber-400'
                    : 'text-slate-400'
              }
            >
              {sentenceCount.toLocaleString()} / {MAX_VOICEOVER_SENTENCES.toLocaleString()} sentences
              {exceedsSentenceLimit ? ' (limit exceeded)' : ''}
            </span>
            <span className="text-slate-500">
              {utf8Bytes.toLocaleString()} UTF-8 bytes
            </span>
          </div>
        </div>

        {/* Language Selector for Voice-over */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="voice-lang-select"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"
            >
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>Voice Language</span>
            </label>
            <span className="text-[11px] text-slate-400">
              {activeLanguageObj.label} · {activeLanguageObj.nativeLabel}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {(['en', 'hi', 'auto', 'es'] as ScriptLanguage[]).map((quickId) => {
              const item = VOICE_LANGUAGES.find((l) => l.id === quickId)!;
              const active = language === quickId;
              return (
                <button
                  key={quickId}
                  type="button"
                  onClick={() => onChangeLanguage(quickId)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors truncate min-h-[38px] ${
                    active
                      ? 'border-sky-500 bg-sky-500/15 text-white font-semibold'
                      : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <select
            id="voice-lang-select"
            value={language}
            onChange={(e) => onChangeLanguage(e.target.value as ScriptLanguage)}
            className="w-full rounded-lg border border-slate-800 bg-[#070B10] px-3 py-2.5 text-xs font-medium text-slate-200 focus:border-sky-500 focus:outline-none min-h-[42px]"
          >
            {VOICE_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.label} — {lang.nativeLabel}
              </option>
            ))}
          </select>
        </div>

        {/* Male & Female Voice Picker */}
        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Voice Persona</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {VOICE_OPTIONS.map((v) => {
              const active = selectedVoice === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onChangeVoice(v.id)}
                  className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors min-h-[44px] ${
                    active
                      ? 'border-sky-500 bg-sky-500/15 text-white'
                      : 'border-slate-800 bg-[#070B10] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <span className="text-xs font-semibold text-white">{v.name}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {v.gender} · {v.tone}
                    </span>
                  </div>
                  {active && (
                    <span className="text-[11px] font-semibold text-sky-400">Active</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Batch Synthesis Progress */}
        {isGeneratingVoiceover && voiceoverProgress && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-sky-300">
                Generating Voice-over ({voiceoverProgress.completedSentences.toLocaleString()} /{' '}
                {voiceoverProgress.totalSentences.toLocaleString()} sentences)
              </span>
              <span className="font-mono tabular-nums text-white font-semibold">
                {voiceoverProgress.percent}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-300"
                style={{ width: `${Math.max(4, voiceoverProgress.percent)}%` }}
              />
            </div>
            <p className="font-mono text-[11px] text-slate-400 tabular-nums">
              Batch {voiceoverProgress.completedChunks} of {voiceoverProgress.totalChunks} completed
            </p>
          </div>
        )}

        {voiceoverError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2.5 text-xs text-rose-200">
            {voiceoverError}
          </div>
        )}

        {voiceover && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-emerald-300">
                Voice-over Ready · {voiceover.voiceId} · {activeLanguageObj.label}
              </span>
              <span className="font-mono tabular-nums text-slate-400">
                {voiceover.sentenceCount
                  ? `${voiceover.sentenceCount.toLocaleString()} sentences · `
                  : ''}
                {formatDurationVerbose(voiceover.durationHintSec)} ·{' '}
                {formatBytes(voiceover.sizeBytes)}
              </span>
            </div>
            <audio controls src={voiceover.audioUrl} className="w-full h-10" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                {hasProject
                  ? 'Synced in Edited Preview and ready for MP4 export.'
                  : 'High-clarity 24kHz WAV ready for playback or download.'}
              </p>
              <a
                href={downloadAudioUrl}
                download="cutflow-voiceover.wav"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download WAV</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
