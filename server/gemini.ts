import fs from 'node:fs';
import path from 'node:path';
import { createPartFromUri, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  MAX_VOICEOVER_SENTENCES,
  VOICE_LANGUAGES,
  type GeneratedScript,
  type ScriptLanguage,
  type ScriptLength,
  type ScriptStyle,
  type VideoAnalysis,
  type VoiceId,
} from '../src/types/studio.js';
import { countSentences } from '../src/utils/format.js';

function getAI() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is missing. Please set your Gemini API key in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('fetch failed');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 500);
      const delayMs = Math.min(18000, 1200 * Math.pow(2, attempt) + jitter);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function uploadVideoToGemini(
  filePath: string,
  mimeType: string
): Promise<{ fileUri: string; fileName: string; mimeType: string }> {
  const ai = getAI();
  const safeMime = mimeType && mimeType.startsWith('video/') ? mimeType : 'video/mp4';

  const uploaded = await ai.files.upload({
    file: filePath,
    config: {
      mimeType: safeMime,
    },
  });

  if (!uploaded.name) {
    throw new Error('Gemini File API did not return a file name.');
  }

  let fileInfo = uploaded;
  const maxAttempts = 90; // up to ~3 minutes for large 15-min videos
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (fileInfo.state === 'ACTIVE') {
      break;
    }
    if (fileInfo.state === 'FAILED') {
      throw new Error('Gemini failed to process the uploaded video file.');
    }
    await new Promise((r) => setTimeout(r, 2000));
    fileInfo = await ai.files.get({ name: uploaded.name });
  }

  if (fileInfo.state !== 'ACTIVE' || !fileInfo.uri) {
    throw new Error('Timed out waiting for Gemini video processing.');
  }

  return {
    fileUri: fileInfo.uri,
    fileName: fileInfo.name || uploaded.name,
    mimeType: fileInfo.mimeType || safeMime,
  };
}

export async function analyzeVideoWithGemini(
  fileUri: string,
  mimeType: string,
  durationSec: number,
  detectedSilences: { startSec: number; endSec: number }[] = []
): Promise<VideoAnalysis> {
  const ai = getAI();
  const videoPart = createPartFromUri(fileUri, mimeType);

  const silenceHint =
    detectedSilences.length > 0
      ? `\nMeasured low-volume audio silence intervals (from waveform scan): ${detectedSilences
          .map((s) => `[${s.startSec.toFixed(1)}s - ${s.endSec.toFixed(1)}s]`)
          .join(', ')}. Verify visually whether each silent pause should be cut.`
      : '';

  const prompt = `Watch and listen carefully to this entire video (total duration: ${durationSec.toFixed(1)} seconds).
Analyze every scene, visual action, gameplay moment, dialogue, audio silence, repeated take, and pacing shift across the full timeline (beginning, middle, and end).${silenceHint}

Provide:
1. A concise summary of what actually happens in the video.
2. Key detected topics/subjects.
3. A pacing note summarizing overall edit opportunities.
4. Interesting / important moments & highlights to PRESERVE (peak gameplay action, clutch moments, key reveals, engaging dialogue) with exact startSec and endSec within [0, ${durationSec.toFixed(1)}].
5. Suggested cuts for:
   - boring: boring pauses, slow/static screens, loading/menu waits
   - silence: dead air / silent sections without important visual action
   - repeated: repeated scenes, duplicate takes, or redundant retakes
   - mistake: mistakes, bloopers, or failed attempts
   - unnecessary: unnecessary filler footage
   Ensure startSec < endSec, all timestamps stay strictly within [0, ${durationSec.toFixed(1)}], and NEVER suggest cutting important gameplay highlights or essential spoken audio.
6. Recommended editing settings (transition, zoom, colorGrade, music preset, and rationale).`;

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts: [videoPart, { text: prompt }] },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            detectedTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            pacingNote: { type: Type.STRING },
            highlights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  title: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  energy: { type: Type.STRING, enum: ['high', 'medium'] },
                },
                required: ['startSec', 'endSec', 'title', 'reason', 'energy'],
              },
            },
            suggestedCuts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  category: {
                    type: Type.STRING,
                    enum: ['boring', 'silence', 'repeated', 'mistake', 'unnecessary'],
                  },
                  reason: { type: Type.STRING },
                },
                required: ['startSec', 'endSec', 'category', 'reason'],
              },
            },
            recommendations: {
              type: Type.OBJECT,
              properties: {
                transition: {
                  type: Type.STRING,
                  enum: ['none', 'crossfade', 'flash', 'fade'],
                },
                zoom: {
                  type: Type.STRING,
                  enum: ['off', 'punch', 'kenburns'],
                },
                colorGrade: {
                  type: Type.STRING,
                  enum: ['original', 'cinematic', 'vibrant', 'crisp'],
                },
                music: {
                  type: Type.STRING,
                  enum: [
                    'none',
                    'upbeat-tech',
                    'chill-ambient',
                    'cinematic-pulse',
                    'gaming-synth',
                  ],
                },
                rationale: { type: Type.STRING },
              },
              required: ['transition', 'zoom', 'colorGrade', 'music', 'rationale'],
            },
          },
          required: [
            'summary',
            'detectedTopics',
            'pacingNote',
            'highlights',
            'suggestedCuts',
            'recommendations',
          ],
        },
      },
    })
  );

  const raw = JSON.parse((response.text ?? '{}').trim());

  const clamp = (n: number) => Math.max(0, Math.min(durationSec, Number(n) || 0));

  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .map((h: Record<string, unknown>, idx: number) => {
      const s = clamp(Number(h.startSec));
      const e = Math.max(s + 0.5, clamp(Number(h.endSec)));
      return {
        id: `hl-${idx + 1}`,
        startSec: Math.round(s * 10) / 10,
        endSec: Math.round(Math.min(durationSec, e) * 10) / 10,
        title: String(h.title || `Highlight ${idx + 1}`),
        reason: String(h.reason || 'Key visual moment'),
        energy: (h.energy === 'high' ? 'high' : 'medium') as 'high' | 'medium',
      };
    })
    .filter((h: { startSec: number; endSec: number }) => h.endSec > h.startSec)
    .sort((a: { startSec: number }, b: { startSec: number }) => a.startSec - b.startSec);

  const validCutCats = ['boring', 'silence', 'repeated', 'mistake', 'unnecessary'] as const;
  type AiCutCat = (typeof validCutCats)[number];

  const rawCuts = (Array.isArray(raw.suggestedCuts) ? raw.suggestedCuts : [])
    .map((c: Record<string, unknown>, idx: number) => {
      const s = clamp(Number(c.startSec));
      const e = clamp(Number(c.endSec));
      const rawCat = String(c.category);
      const category: AiCutCat = (validCutCats as readonly string[]).includes(rawCat)
        ? (rawCat as AiCutCat)
        : 'boring';
      return {
        id: `cut-${idx + 1}`,
        startSec: Math.round(s * 10) / 10,
        endSec: Math.round(e * 10) / 10,
        category,
        reason: String(c.reason || 'Slow pacing segment'),
        approved: true,
      };
    })
    .filter(
      (c: { startSec: number; endSec: number }) =>
        c.endSec - c.startSec >= 0.4 && c.endSec <= durationSec
    )
    // Protect high-energy gameplay / key moments from accidental overlap cuts
    .filter((c: { startSec: number; endSec: number }) => {
      const cutDur = c.endSec - c.startSec;
      return !highlights.some((h: { startSec: number; endSec: number; energy: string }) => {
        if (h.energy !== 'high') return false;
        const overlap = Math.min(c.endSec, h.endSec) - Math.max(c.startSec, h.startSec);
        return overlap > cutDur * 0.45;
      });
    })
    .sort((a: { startSec: number }, b: { startSec: number }) => a.startSec - b.startSec);

  // Deduplicate overlapping cut suggestions cleanly
  const suggestedCuts: typeof rawCuts = [];
  for (const cut of rawCuts) {
    const prev = suggestedCuts[suggestedCuts.length - 1];
    if (prev && cut.startSec < prev.endSec - 0.1) {
      if (cut.endSec > prev.endSec) {
        prev.endSec = cut.endSec;
        if (!prev.reason.includes(cut.reason)) {
          prev.reason = `${prev.reason}; ${cut.reason}`;
        }
      }
    } else {
      suggestedCuts.push(cut);
    }
  }

  return {
    summary: String(raw.summary || 'Video analyzed successfully.'),
    detectedTopics: Array.isArray(raw.detectedTopics)
      ? raw.detectedTopics.map(String).slice(0, 6)
      : [],
    pacingNote: String(raw.pacingNote || 'Balanced pacing detected.'),
    highlights,
    suggestedCuts,
    recommendations: raw.recommendations || {
      transition: 'crossfade',
      zoom: 'punch',
      colorGrade: 'cinematic',
      music: 'upbeat-tech',
      rationale: 'Recommended smooth crossfade transitions while preserving key action and audio.',
    },
  };
}

const STYLE_INSTRUCTIONS: Record<ScriptStyle, string> = {
  professional:
    'Write in a crisp, authoritative, executive documentary / corporate presenter style.',
  funny:
    'Write with sharp comedic timing, witty observations about what happens on screen, and playful punchlines.',
  entertainment:
    'Write like a charismatic entertainment host with high-energy hooks and engaging audience callouts.',
  gaming:
    'Write like an energetic gaming creator / streamer reacting live to the action with hype callouts and commentary.',
  storytelling:
    'Write as a gripping narrative storyteller with an opening hook, rising tension, and satisfying payoff.',
  informative:
    'Write as a clear, structured educator explaining every visible detail and concept concisely.',
  youtube:
    'Write as a high-retention YouTube voice-over creator: punchy opening hook in the first 5 seconds, smooth transitions, and clear pacing.',
};

const LENGTH_GUIDANCE: Record<ScriptLength, string> = {
  short: 'Keep it concise and punchy (roughly 60–110 words total, 3–4 tight sections).',
  medium: 'Write a balanced, natural narration (roughly 140–240 words total, 4–6 sections).',
  long: 'Write a comprehensive, detailed scene-by-scene script (roughly 280–480 words total, 6–10 sections).',
};

export async function generateScriptWithGemini(
  fileUri: string,
  mimeType: string,
  durationSec: number,
  editedDurationSec: number,
  style: ScriptStyle,
  length: ScriptLength,
  language: ScriptLanguage
): Promise<GeneratedScript> {
  const ai = getAI();
  const videoPart = createPartFromUri(fileUri, mimeType);

  const langInfo = VOICE_LANGUAGES.find((l) => l.id === language);
  const langRule =
    language === 'hi'
      ? 'Write ALL script text, headings, and narration in natural, conversational Hindi (using Devanagari script, e.g. "नमस्ते दोस्तों..."). Do NOT output English narration when Hindi is requested.'
      : language === 'auto' || language === 'en' || !langInfo
        ? 'Write ALL script text, headings, and narration in natural spoken English.'
        : `Write ALL script text, headings, and narration in natural, conversational ${langInfo.promptName}.`;

  const prompt = `Watch and understand the actual visual scenes and audio in this video (original length ${durationSec.toFixed(1)}s, edited length ~${editedDurationSec.toFixed(1)}s).
Write a voice-over script directly grounded in what actually appears and happens in the video.
Style: ${STYLE_INSTRUCTIONS[style]}
Length: ${LENGTH_GUIDANCE[length]}
Language: ${langRule}
Ensure the narration reads naturally aloud when spoken by a text-to-speech voice (avoid stage brackets like [SFX] or [CUT] inside the spoken narration text).`;

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts: [videoPart, { text: prompt }] },
      config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                heading: { type: Type.STRING },
                narration: { type: Type.STRING },
              },
              required: ['startSec', 'endSec', 'heading', 'narration'],
            },
          },
        },
        required: ['title', 'sections'],
      },
    },
    })
  );

  const raw = JSON.parse((response.text ?? '{}').trim());
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map(
    (s: Record<string, unknown>, idx: number) => ({
      id: `sec-${idx + 1}`,
      startSec: Math.max(0, Math.min(durationSec, Number(s.startSec) || 0)),
      endSec: Math.max(0, Math.min(durationSec, Number(s.endSec) || durationSec)),
      heading: String(s.heading || `Part ${idx + 1}`),
      narration: String(s.narration || '').trim(),
    })
  );

  const fullText = sections.map((s: { narration: string }) => s.narration).join('\n\n');

  return {
    title: String(raw.title || 'AI Video Script'),
    style,
    length,
    language,
    fullText,
    sections,
  };
}

const MAX_TTS_REQUEST_BYTES = 10000;
const TARGET_TTS_CHUNK_BYTES = 5200;
const TTS_CONCURRENCY = 4;

function sliceStringByMaxBytes(str: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const ch of str) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > maxBytes && current.length > 0) {
      parts.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

export function splitTextForTTS(text: string, maxBytes = TARGET_TTS_CHUNK_BYTES): string[] {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return [];
  if (Buffer.byteLength(cleaned, 'utf8') <= maxBytes) return [cleaned];

  const chunks: string[] = [];
  const sentences = cleaned.split(/(?<=[।॥.!?\u061F])\s+|(?<=[\u3002\uFF01\uFF1F])\s*|\n+/);
  let current = '';

  const flushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    if (Buffer.byteLength(trimmedSentence, 'utf8') > maxBytes) {
      flushCurrent();
      const tokens = trimmedSentence.split(/(?<=[,;:\-—、，])\s*|\s+/);
      let sub = '';

      for (const token of tokens) {
        if (!token) continue;
        if (Buffer.byteLength(token, 'utf8') > maxBytes) {
          if (sub.trim()) {
            chunks.push(sub.trim());
            sub = '';
          }
          chunks.push(...sliceStringByMaxBytes(token, maxBytes));
          continue;
        }
        const candidate = sub ? `${sub} ${token}` : token;
        if (Buffer.byteLength(candidate, 'utf8') > maxBytes && sub) {
          chunks.push(sub.trim());
          sub = token;
        } else {
          sub = candidate;
        }
      }
      if (sub.trim()) chunks.push(sub.trim());
      continue;
    }

    const candidate = current ? `${current} ${trimmedSentence}` : trimmedSentence;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes && current) {
      flushCurrent();
      current = trimmedSentence;
    } else {
      current = candidate;
    }
  }

  flushCurrent();
  return chunks;
}

function buildWavHeader(dataSize: number, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

function buildWavFromPcm(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  return Buffer.concat([buildWavHeader(pcm.length, sampleRate, channels), pcm]);
}

function extractPcmAndFormat(wavOrPcm: Buffer): {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
} {
  if (
    wavOrPcm.length >= 44 &&
    wavOrPcm.subarray(0, 4).toString('ascii') === 'RIFF' &&
    wavOrPcm.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    const channels = wavOrPcm.readUInt16LE(22) || 1;
    const sampleRate = wavOrPcm.readUInt32LE(24) || 24000;
    const dataOffset = wavOrPcm.indexOf(Buffer.from('data'));
    const pcmStart =
      dataOffset !== -1 && dataOffset + 8 <= wavOrPcm.length ? dataOffset + 8 : 44;
    return {
      pcm: wavOrPcm.subarray(pcmStart),
      sampleRate,
      channels,
    };
  }
  return { pcm: wavOrPcm, sampleRate: 24000, channels: 1 };
}

function concatWavBuffers(wavBuffers: Buffer[]): Buffer {
  if (wavBuffers.length === 1) {
    const { pcm, sampleRate, channels } = extractPcmAndFormat(wavBuffers[0]);
    if (
      wavBuffers[0].length >= 44 &&
      wavBuffers[0].subarray(0, 4).toString('ascii') === 'RIFF'
    ) {
      return wavBuffers[0];
    }
    return buildWavFromPcm(pcm, sampleRate, channels);
  }

  const parsed = wavBuffers.map(extractPcmAndFormat);
  const { sampleRate, channels } = parsed[0];
  const combinedPcm = Buffer.concat(parsed.map((p) => p.pcm));
  return buildWavFromPcm(combinedPcm, sampleRate, channels);
}

const VOICE_STYLE_PROMPT: Record<VoiceId, string> = {
  Kore: 'warm, clear female voice',
  Zephyr: 'bright, crisp female voice',
  Charon: 'deep, authoritative male voice',
  Fenrir: 'bold, energetic male voice',
  Puck: 'friendly, expressive male voice',
};

export interface VoiceoverSynthesisProgress {
  completedChunks: number;
  totalChunks: number;
  completedSentences: number;
  totalSentences: number;
}

export interface VoiceoverBatchResult {
  wavBuffer?: Buffer;
  filePath?: string;
  sizeBytes: number;
  durationHintSec: number;
  chunkCount: number;
  sentenceCount: number;
}

export async function generateVoiceoverBatch(options: {
  scriptText: string;
  voiceId: VoiceId;
  language: ScriptLanguage;
  outFilePath?: string;
  onProgress?: (progress: VoiceoverSynthesisProgress) => void;
}): Promise<VoiceoverBatchResult> {
  const { scriptText, voiceId, language, outFilePath, onProgress } = options;

  const sentenceCount = countSentences(scriptText);
  if (sentenceCount === 0) {
    throw new Error('Script text cannot be empty.');
  }
  if (sentenceCount > MAX_VOICEOVER_SENTENCES) {
    throw new Error(
      `Script contains ${sentenceCount.toLocaleString()} sentences, exceeding the ${MAX_VOICEOVER_SENTENCES.toLocaleString()}-sentence limit per voice-over.`
    );
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is missing. Please set your Gemini API key in Settings > Secrets.');
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const voiceDesc = VOICE_STYLE_PROMPT[voiceId] || 'clear video narrator';
  const langOption = VOICE_LANGUAGES.find((l) => l.id === language);
  const promptPrefix =
    language === 'auto' || !langOption
      ? `Read the following script aloud naturally in its original language using a ${voiceDesc}, with clear pronunciation, natural pacing, and no extra commentary:\n\n`
      : `Read the following ${langOption.promptName} script aloud naturally in a ${voiceDesc}, with clear pronunciation, natural pacing, and no extra commentary:\n\n`;

  const prefixBytes = Buffer.byteLength(promptPrefix, 'utf8');
  const hardMaxChunkBytes = Math.max(500, MAX_TTS_REQUEST_BYTES - prefixBytes - 200);
  const effectiveChunkBytes = Math.min(TARGET_TTS_CHUNK_BYTES, hardMaxChunkBytes);

  const chunks = splitTextForTTS(scriptText, effectiveChunkBytes);
  if (chunks.length === 0) {
    throw new Error('Script text cannot be empty.');
  }

  const chunkSentenceCounts = chunks.map((c) => Math.max(1, countSentences(c)));
  const totalWeightedSentences = chunkSentenceCounts.reduce((a, b) => a + b, 0);

  let completedChunks = 0;
  let completedWeightedSentences = 0;
  let sampleRate = 24000;
  let channels = 1;
  let totalPcmBytes = 0;

  let fd: number | null = null;
  let writeOffset = 44;
  if (outFilePath) {
    fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
    fd = fs.openSync(outFilePath, 'w');
    // Reserve 44-byte RIFF/WAVE header at start of file
    fs.writeSync(fd, buildWavHeader(0, sampleRate, channels), 0, 44, 0);
  }

  const orderedPcm = new Map<number, Buffer>();
  const inMemoryWavs: Buffer[] = outFilePath ? [] : new Array<Buffer>(chunks.length);
  let nextWriteIdx = 0;

  const flushReadyChunksToDisk = () => {
    if (fd === null) return;
    while (orderedPcm.has(nextWriteIdx)) {
      const pcm = orderedPcm.get(nextWriteIdx)!;
      orderedPcm.delete(nextWriteIdx);
      if (pcm.length > 0) {
        fs.writeSync(fd, pcm, 0, pcm.length, writeOffset);
        writeOffset += pcm.length;
        totalPcmBytes += pcm.length;
      }
      nextWriteIdx++;
    }
  };

  let cursor = 0;
  const workerCount = Math.min(TTS_CONCURRENCY, chunks.length);

  try {
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= chunks.length) break;

        const chunk = chunks[idx];
        const prompt = `${promptPrefix}${chunk}`;
        if (Buffer.byteLength(prompt, 'utf8') > MAX_TTS_REQUEST_BYTES) {
          throw new Error('Voiceover text chunk exceeds the 10,000-byte limit.');
        }

        const response = await withGeminiRetry(() =>
          ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: prompt,
            config: {
              responseModalities: ['AUDIO'],
            },
          })
        );

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = inlineData?.data;
        if (!base64Audio) {
          throw new Error('Gemini TTS did not return audio data.');
        }

        const rawBuf = Buffer.from(base64Audio, 'base64');
        const extracted = extractPcmAndFormat(rawBuf);
        if (idx === 0) {
          sampleRate = extracted.sampleRate;
          channels = extracted.channels;
        }

        if (fd !== null) {
          orderedPcm.set(idx, extracted.pcm);
          flushReadyChunksToDisk();
        } else {
          inMemoryWavs[idx] = buildWavFromPcm(
            extracted.pcm,
            extracted.sampleRate,
            extracted.channels
          );
          totalPcmBytes += extracted.pcm.length;
        }

        completedChunks++;
        completedWeightedSentences += chunkSentenceCounts[idx];
        const approxCompletedSentences =
          completedChunks === chunks.length
            ? sentenceCount
            : Math.min(
                sentenceCount,
                Math.round((completedWeightedSentences / totalWeightedSentences) * sentenceCount)
              );

        onProgress?.({
          completedChunks,
          totalChunks: chunks.length,
          completedSentences: approxCompletedSentences,
          totalSentences: sentenceCount,
        });
      }
    });

    await Promise.all(workers);

    if (fd !== null && outFilePath) {
      flushReadyChunksToDisk();
      const finalHeader = buildWavHeader(totalPcmBytes, sampleRate, channels);
      fs.writeSync(fd, finalHeader, 0, 44, 0);
      fs.closeSync(fd);
      fd = null;

      const bytesPerSec = sampleRate * channels * 2;
      const durationHintSec = Math.round((totalPcmBytes / bytesPerSec) * 10) / 10;
      return {
        filePath: outFilePath,
        sizeBytes: 44 + totalPcmBytes,
        durationHintSec,
        chunkCount: chunks.length,
        sentenceCount,
      };
    }

    const wavBuffer = concatWavBuffers(inMemoryWavs);
    const bytesPerSec = sampleRate * channels * 2;
    const durationHintSec = Math.round((Math.max(0, wavBuffer.length - 44) / bytesPerSec) * 10) / 10;
    return {
      wavBuffer,
      sizeBytes: wavBuffer.length,
      durationHintSec,
      chunkCount: chunks.length,
      sentenceCount,
    };
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error
      }
      if (outFilePath && fs.existsSync(outFilePath)) {
        try {
          fs.unlinkSync(outFilePath);
        } catch {
          // Ignore cleanup error
        }
      }
    }
    throw err;
  }
}

export async function generateVoiceoverWithGemini(
  scriptText: string,
  voiceId: VoiceId,
  language: ScriptLanguage
): Promise<Buffer> {
  const result = await generateVoiceoverBatch({
    scriptText,
    voiceId,
    language,
  });
  if (!result.wavBuffer) {
    throw new Error('Failed to generate voiceover buffer.');
  }
  return result.wavBuffer;
}
