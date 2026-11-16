export type ScriptStyle =
  | 'professional'
  | 'funny'
  | 'entertainment'
  | 'gaming'
  | 'storytelling'
  | 'informative'
  | 'youtube';

export type ScriptLength = 'short' | 'medium' | 'long';
export type ScriptLanguage =
  | 'auto'
  | 'en'
  | 'hi'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'it'
  | 'ja'
  | 'ko'
  | 'ar'
  | 'bn'
  | 'ta'
  | 'te'
  | 'mr'
  | 'id';

export const MAX_VOICEOVER_SENTENCES = 5000;

export interface LanguageOption {
  id: ScriptLanguage;
  label: string;
  nativeLabel: string;
  promptName: string;
  supportsScriptGen: boolean;
}

export const VOICE_LANGUAGES: LanguageOption[] = [
  { id: 'en', label: 'English', nativeLabel: 'English', promptName: 'English', supportsScriptGen: true },
  { id: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', promptName: 'Hindi (Devanagari script)', supportsScriptGen: true },
  { id: 'auto', label: 'Auto-Detect', nativeLabel: 'Multilingual', promptName: 'the same language as the input text', supportsScriptGen: false },
  { id: 'es', label: 'Spanish', nativeLabel: 'Español', promptName: 'Spanish', supportsScriptGen: true },
  { id: 'fr', label: 'French', nativeLabel: 'Français', promptName: 'French', supportsScriptGen: true },
  { id: 'de', label: 'German', nativeLabel: 'Deutsch', promptName: 'German', supportsScriptGen: true },
  { id: 'pt', label: 'Portuguese', nativeLabel: 'Português', promptName: 'Portuguese', supportsScriptGen: true },
  { id: 'it', label: 'Italian', nativeLabel: 'Italiano', promptName: 'Italian', supportsScriptGen: true },
  { id: 'ja', label: 'Japanese', nativeLabel: '日本語', promptName: 'Japanese', supportsScriptGen: true },
  { id: 'ko', label: 'Korean', nativeLabel: '한국어', promptName: 'Korean', supportsScriptGen: true },
  { id: 'ar', label: 'Arabic', nativeLabel: 'العربية', promptName: 'Arabic', supportsScriptGen: true },
  { id: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', promptName: 'Bengali', supportsScriptGen: true },
  { id: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', promptName: 'Tamil', supportsScriptGen: true },
  { id: 'te', label: 'Telugu', nativeLabel: 'తెలుగు', promptName: 'Telugu', supportsScriptGen: true },
  { id: 'mr', label: 'Marathi', nativeLabel: 'मराठी', promptName: 'Marathi', supportsScriptGen: true },
  { id: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', promptName: 'Indonesian', supportsScriptGen: true },
];

export type CutCategory =
  | 'boring'
  | 'silence'
  | 'repeated'
  | 'mistake'
  | 'unnecessary'
  | 'manual';

export type TransitionPreset = 'none' | 'crossfade' | 'flash' | 'fade';
export type ZoomPreset = 'off' | 'punch' | 'kenburns';
export type ColorGradePreset = 'original' | 'cinematic' | 'vibrant' | 'crisp';
export type MusicPreset = 'none' | 'upbeat-tech' | 'chill-ambient' | 'cinematic-pulse' | 'gaming-synth';

export type VoiceId = 'Kore' | 'Zephyr' | 'Charon' | 'Fenrir' | 'Puck';

export interface VoiceOption {
  id: VoiceId;
  name: string;
  gender: 'Female' | 'Male';
  tone: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Kore', name: 'Kore', gender: 'Female', tone: 'Warm & Clear' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'Female', tone: 'Bright & Crisp' },
  { id: 'Charon', name: 'Charon', gender: 'Male', tone: 'Deep & Authoritative' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Male', tone: 'Bold & Energetic' },
  { id: 'Puck', name: 'Puck', gender: 'Male', tone: 'Friendly & Expressive' },
];

export const SCRIPT_STYLES: { id: ScriptStyle; label: string; summary: string }[] = [
  { id: 'professional', label: 'Professional', summary: 'Clean, structured executive tone' },
  { id: 'funny', label: 'Funny', summary: 'Witty punchlines and playful pacing' },
  { id: 'entertainment', label: 'Entertainment', summary: 'High-energy pop culture hook' },
  { id: 'gaming', label: 'Gaming Commentary', summary: 'Fast reaction callouts and hype' },
  { id: 'storytelling', label: 'Storytelling', summary: 'Narrative arc with emotional beats' },
  { id: 'informative', label: 'Informative', summary: 'Clear educational breakdown' },
  { id: 'youtube', label: 'YouTube Voice-over', summary: 'Retention-focused creator narration' },
];

export interface VideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sizeBytes: number;
  codec: string;
}

export interface VideoProject {
  id: string;
  originalName: string;
  mimeType: string;
  videoUrl: string;
  thumbnails: string[];
  metadata: VideoMetadata;
  geminiReady: boolean;
  isSample?: boolean;
}

export interface HighlightSegment {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  energy: 'high' | 'medium';
}

export interface CutSuggestion {
  id: string;
  startSec: number;
  endSec: number;
  category: CutCategory;
  reason: string;
  approved: boolean;
}

export interface EditRecommendations {
  transition: TransitionPreset;
  zoom: ZoomPreset;
  colorGrade: ColorGradePreset;
  music: MusicPreset;
  rationale: string;
}

export interface VideoAnalysis {
  summary: string;
  detectedTopics: string[];
  pacingNote: string;
  highlights: HighlightSegment[];
  suggestedCuts: CutSuggestion[];
  recommendations: EditRecommendations;
}

export interface EditSettings {
  transition: TransitionPreset;
  zoom: ZoomPreset;
  colorGrade: ColorGradePreset;
  music: MusicPreset;
  originalAudioVolume: number; // 0 to 1
  musicVolume: number; // 0 to 1
  voiceoverVolume: number; // 0 to 1
  exportQuality: '720p' | '1080p';
}

export interface ScriptSection {
  id: string;
  startSec: number;
  endSec: number;
  heading: string;
  narration: string;
}

export interface GeneratedScript {
  title: string;
  style: ScriptStyle;
  length: ScriptLength;
  language: ScriptLanguage;
  fullText: string;
  sections: ScriptSection[];
}

export interface VoiceoverResult {
  audioUrl: string;
  voiceId: VoiceId;
  language: ScriptLanguage;
  durationHintSec: number;
  sizeBytes: number;
  sentenceCount?: number;
  chunkCount?: number;
}

export interface VoiceoverJobProgress {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  totalSentences: number;
  completedSentences: number;
  totalChunks: number;
  completedChunks: number;
  percent: number;
  voiceover?: VoiceoverResult;
  error?: string;
}

export interface ExportResult {
  downloadUrl: string;
  filename: string;
  sizeBytes: number;
  editedDurationSec: number;
  cutsApplied: number;
}
