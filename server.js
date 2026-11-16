// server.ts
import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import multer from "multer";

// server/gemini.ts
import { createPartFromUri, GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
function getAI() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
async function withGeminiRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand") || msg.includes("429");
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 1200 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
async function uploadVideoToGemini(filePath, mimeType) {
  const ai = getAI();
  const safeMime = mimeType && mimeType.startsWith("video/") ? mimeType : "video/mp4";
  const uploaded = await ai.files.upload({
    file: filePath,
    config: {
      mimeType: safeMime
    }
  });
  if (!uploaded.name) {
    throw new Error("Gemini File API did not return a file name.");
  }
  let fileInfo = uploaded;
  const maxAttempts = 90;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (fileInfo.state === "ACTIVE") {
      break;
    }
    if (fileInfo.state === "FAILED") {
      throw new Error("Gemini failed to process the uploaded video file.");
    }
    await new Promise((r) => setTimeout(r, 2e3));
    fileInfo = await ai.files.get({ name: uploaded.name });
  }
  if (fileInfo.state !== "ACTIVE" || !fileInfo.uri) {
    throw new Error("Timed out waiting for Gemini video processing.");
  }
  return {
    fileUri: fileInfo.uri,
    fileName: fileInfo.name || uploaded.name,
    mimeType: fileInfo.mimeType || safeMime
  };
}
async function analyzeVideoWithGemini(fileUri, mimeType, durationSec) {
  const ai = getAI();
  const videoPart = createPartFromUri(fileUri, mimeType);
  const prompt = `Watch and listen carefully to this entire video (total duration: ${durationSec.toFixed(1)} seconds).
Analyze every scene, visual movement, audio cue, dialogue, silence, and pacing shift.
Provide:
1. A concise summary of what actually happens in the video.
2. Key detected topics/subjects.
3. A pacing note.
4. Interesting moments / highlights (exact startSec and endSec within 0 to ${durationSec.toFixed(1)}).
5. Suggested cuts for boring parts, dead air / silence, unnecessary scenes, or mistakes/outtakes (exact startSec and endSec within 0 to ${durationSec.toFixed(1)}). Only suggest cuts that genuinely improve pacing; ensure startSec < endSec and timestamps stay strictly within [0, ${durationSec.toFixed(1)}].
6. Recommended editing settings (transition, zoom, colorGrade, music preset, and rationale).`;
  const response = await withGeminiRetry(
    () => ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: { parts: [videoPart, { text: prompt }] },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            detectedTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
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
                  energy: { type: Type.STRING, enum: ["high", "medium"] }
                },
                required: ["startSec", "endSec", "title", "reason", "energy"]
              }
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
                    enum: ["boring", "mistake", "unnecessary", "silence"]
                  },
                  reason: { type: Type.STRING }
                },
                required: ["startSec", "endSec", "category", "reason"]
              }
            },
            recommendations: {
              type: Type.OBJECT,
              properties: {
                transition: {
                  type: Type.STRING,
                  enum: ["none", "crossfade", "flash", "fade"]
                },
                zoom: {
                  type: Type.STRING,
                  enum: ["off", "punch", "kenburns"]
                },
                colorGrade: {
                  type: Type.STRING,
                  enum: ["original", "cinematic", "vibrant", "crisp"]
                },
                music: {
                  type: Type.STRING,
                  enum: [
                    "none",
                    "upbeat-tech",
                    "chill-ambient",
                    "cinematic-pulse",
                    "gaming-synth"
                  ]
                },
                rationale: { type: Type.STRING }
              },
              required: ["transition", "zoom", "colorGrade", "music", "rationale"]
            }
          },
          required: [
            "summary",
            "detectedTopics",
            "pacingNote",
            "highlights",
            "suggestedCuts",
            "recommendations"
          ]
        }
      }
    })
  );
  const raw = JSON.parse((response.text ?? "{}").trim());
  const clamp = (n) => Math.max(0, Math.min(durationSec, Number(n) || 0));
  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : []).map((h, idx) => {
    const s = clamp(Number(h.startSec));
    const e = Math.max(s + 0.5, clamp(Number(h.endSec)));
    return {
      id: `hl-${idx + 1}`,
      startSec: Math.round(s * 10) / 10,
      endSec: Math.round(Math.min(durationSec, e) * 10) / 10,
      title: String(h.title || `Highlight ${idx + 1}`),
      reason: String(h.reason || "Key visual moment"),
      energy: h.energy === "high" ? "high" : "medium"
    };
  }).filter((h) => h.endSec > h.startSec);
  const suggestedCuts = (Array.isArray(raw.suggestedCuts) ? raw.suggestedCuts : []).map((c, idx) => {
    const s = clamp(Number(c.startSec));
    const e = clamp(Number(c.endSec));
    return {
      id: `cut-${idx + 1}`,
      startSec: Math.round(s * 10) / 10,
      endSec: Math.round(e * 10) / 10,
      category: ["boring", "mistake", "unnecessary", "silence"].includes(
        String(c.category)
      ) ? String(c.category) : "boring",
      reason: String(c.reason || "Slow pacing segment"),
      approved: true
    };
  }).filter(
    (c) => c.endSec - c.startSec >= 0.4 && c.endSec <= durationSec
  );
  return {
    summary: String(raw.summary || "Video analyzed successfully."),
    detectedTopics: Array.isArray(raw.detectedTopics) ? raw.detectedTopics.map(String).slice(0, 6) : [],
    pacingNote: String(raw.pacingNote || "Balanced pacing detected."),
    highlights,
    suggestedCuts,
    recommendations: raw.recommendations || {
      transition: "crossfade",
      zoom: "punch",
      colorGrade: "cinematic",
      music: "upbeat-tech",
      rationale: "Recommended smooth transitions and punch-in framing."
    }
  };
}
var STYLE_INSTRUCTIONS = {
  professional: "Write in a crisp, authoritative, executive documentary / corporate presenter style.",
  funny: "Write with sharp comedic timing, witty observations about what happens on screen, and playful punchlines.",
  entertainment: "Write like a charismatic entertainment host with high-energy hooks and engaging audience callouts.",
  gaming: "Write like an energetic gaming creator / streamer reacting live to the action with hype callouts and commentary.",
  storytelling: "Write as a gripping narrative storyteller with an opening hook, rising tension, and satisfying payoff.",
  informative: "Write as a clear, structured educator explaining every visible detail and concept concisely.",
  youtube: "Write as a high-retention YouTube voice-over creator: punchy opening hook in the first 5 seconds, smooth transitions, and clear pacing."
};
var LENGTH_GUIDANCE = {
  short: "Keep it concise and punchy (roughly 60\u2013110 words total, 3\u20134 tight sections).",
  medium: "Write a balanced, natural narration (roughly 140\u2013240 words total, 4\u20136 sections).",
  long: "Write a comprehensive, detailed scene-by-scene script (roughly 280\u2013480 words total, 6\u201310 sections)."
};
async function generateScriptWithGemini(fileUri, mimeType, durationSec, editedDurationSec, style, length, language) {
  const ai = getAI();
  const videoPart = createPartFromUri(fileUri, mimeType);
  const langRule = language === "hi" ? 'Write ALL script text, headings, and narration in natural, conversational Hindi (using Devanagari script, e.g. "\u0928\u092E\u0938\u094D\u0924\u0947 \u0926\u094B\u0938\u094D\u0924\u094B\u0902..."). Do NOT output English narration when Hindi is requested.' : "Write ALL script text, headings, and narration in natural spoken English.";
  const prompt = `Watch and understand the actual visual scenes and audio in this video (original length ${durationSec.toFixed(1)}s, edited length ~${editedDurationSec.toFixed(1)}s).
Write a voice-over script directly grounded in what actually appears and happens in the video.
Style: ${STYLE_INSTRUCTIONS[style]}
Length: ${LENGTH_GUIDANCE[length]}
Language: ${langRule}
Ensure the narration reads naturally aloud when spoken by a text-to-speech voice (avoid stage brackets like [SFX] or [CUT] inside the spoken narration text).`;
  const response = await withGeminiRetry(
    () => ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: { parts: [videoPart, { text: prompt }] },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
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
                  narration: { type: Type.STRING }
                },
                required: ["startSec", "endSec", "heading", "narration"]
              }
            }
          },
          required: ["title", "sections"]
        }
      }
    })
  );
  const raw = JSON.parse((response.text ?? "{}").trim());
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map(
    (s, idx) => ({
      id: `sec-${idx + 1}`,
      startSec: Math.max(0, Math.min(durationSec, Number(s.startSec) || 0)),
      endSec: Math.max(0, Math.min(durationSec, Number(s.endSec) || durationSec)),
      heading: String(s.heading || `Part ${idx + 1}`),
      narration: String(s.narration || "").trim()
    })
  );
  const fullText = sections.map((s) => s.narration).join("\n\n");
  return {
    title: String(raw.title || "AI Video Script"),
    style,
    length,
    language,
    fullText,
    sections
  };
}
var MAX_TTS_REQUEST_BYTES = 1e4;
var TARGET_TTS_CHUNK_BYTES = 2800;
function sliceStringByMaxBytes(str, maxBytes) {
  const parts = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of str) {
    const chBytes = Buffer.byteLength(ch, "utf8");
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
function splitTextForTTS(text, maxBytes = TARGET_TTS_CHUNK_BYTES) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (Buffer.byteLength(cleaned, "utf8") <= maxBytes) return [cleaned];
  const chunks = [];
  const sentences = cleaned.split(/(?<=[।.!?\n])\s+/);
  let current = "";
  const flushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    if (Buffer.byteLength(trimmedSentence, "utf8") > maxBytes) {
      flushCurrent();
      const tokens = trimmedSentence.split(/(?<=[,;:\-—])\s+|\s+/);
      let sub = "";
      for (const token of tokens) {
        if (!token) continue;
        if (Buffer.byteLength(token, "utf8") > maxBytes) {
          if (sub.trim()) {
            chunks.push(sub.trim());
            sub = "";
          }
          chunks.push(...sliceStringByMaxBytes(token, maxBytes));
          continue;
        }
        const candidate2 = sub ? `${sub} ${token}` : token;
        if (Buffer.byteLength(candidate2, "utf8") > maxBytes && sub) {
          chunks.push(sub.trim());
          sub = token;
        } else {
          sub = candidate2;
        }
      }
      if (sub.trim()) chunks.push(sub.trim());
      continue;
    }
    const candidate = current ? `${current} ${trimmedSentence}` : trimmedSentence;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes && current) {
      flushCurrent();
      current = trimmedSentence;
    } else {
      current = candidate;
    }
  }
  flushCurrent();
  return chunks;
}
function buildWavFromPcm(pcm, sampleRate = 24e3, channels = 1) {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
function extractPcmAndFormat(wavOrPcm) {
  if (wavOrPcm.length >= 44 && wavOrPcm.subarray(0, 4).toString("ascii") === "RIFF" && wavOrPcm.subarray(8, 12).toString("ascii") === "WAVE") {
    const channels = wavOrPcm.readUInt16LE(22) || 1;
    const sampleRate = wavOrPcm.readUInt32LE(24) || 24e3;
    const dataOffset = wavOrPcm.indexOf(Buffer.from("data"));
    const pcmStart = dataOffset !== -1 && dataOffset + 8 <= wavOrPcm.length ? dataOffset + 8 : 44;
    return {
      pcm: wavOrPcm.subarray(pcmStart),
      sampleRate,
      channels
    };
  }
  return { pcm: wavOrPcm, sampleRate: 24e3, channels: 1 };
}
function concatWavBuffers(wavBuffers) {
  if (wavBuffers.length === 1) {
    const { pcm, sampleRate: sampleRate2, channels: channels2 } = extractPcmAndFormat(wavBuffers[0]);
    if (wavBuffers[0].length >= 44 && wavBuffers[0].subarray(0, 4).toString("ascii") === "RIFF") {
      return wavBuffers[0];
    }
    return buildWavFromPcm(pcm, sampleRate2, channels2);
  }
  const parsed = wavBuffers.map(extractPcmAndFormat);
  const { sampleRate, channels } = parsed[0];
  const combinedPcm = Buffer.concat(parsed.map((p) => p.pcm));
  return buildWavFromPcm(combinedPcm, sampleRate, channels);
}
function wrapPcmAsWav(pcm, sampleRate = 24e3, channels = 1) {
  if (pcm.length >= 44 && pcm.subarray(0, 4).toString("ascii") === "RIFF" && pcm.subarray(8, 12).toString("ascii") === "WAVE") {
    return pcm;
  }
  return buildWavFromPcm(pcm, sampleRate, channels);
}
var VOICE_STYLE_PROMPT = {
  Kore: "warm, clear female voice",
  Zephyr: "bright, crisp female voice",
  Charon: "deep, authoritative male voice",
  Fenrir: "bold, energetic male voice",
  Puck: "friendly, expressive male voice"
};
async function generateVoiceoverWithGemini(scriptText, voiceId, language) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  const voiceDesc = VOICE_STYLE_PROMPT[voiceId] || "clear video narrator";
  const langLabel = language === "hi" ? "Hindi" : "English";
  const promptPrefix = `Read the following ${langLabel} script aloud naturally in a ${voiceDesc}, with clear pacing and no extra commentary:

`;
  const prefixBytes = Buffer.byteLength(promptPrefix, "utf8");
  const hardMaxChunkBytes = Math.max(500, MAX_TTS_REQUEST_BYTES - prefixBytes - 200);
  const effectiveChunkBytes = Math.min(TARGET_TTS_CHUNK_BYTES, hardMaxChunkBytes);
  const chunks = splitTextForTTS(scriptText, effectiveChunkBytes);
  if (chunks.length === 0) {
    throw new Error("Script text cannot be empty.");
  }
  const wavBuffers = [];
  for (const chunk of chunks) {
    const prompt = `${promptPrefix}${chunk}`;
    if (Buffer.byteLength(prompt, "utf8") > MAX_TTS_REQUEST_BYTES) {
      throw new Error("Voiceover text chunk exceeds the 10,000-byte limit.");
    }
    const response = await withGeminiRetry(
      () => ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: prompt,
        config: {
          responseModalities: ["AUDIO"]
        }
      })
    );
    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlineData?.data;
    if (!base64Audio) {
      throw new Error("Gemini TTS did not return audio data.");
    }
    const rawBuf = Buffer.from(base64Audio, "base64");
    wavBuffers.push(wrapPcmAsWav(rawBuf));
  }
  return concatWavBuffers(wavBuffers);
}

// server/media.ts
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function probeVideo(filePath) {
  const stat = fs.statSync(filePath);
  let stdout = "";
  try {
    const res = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]);
    stdout = res.stdout;
  } catch {
    throw new Error("Could not read video file. Please upload a valid MP4, MOV, or WebM video.");
  }
  const parsed = JSON.parse(stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");
  if (!videoStream) {
    throw new Error("No valid video track found in the uploaded file.");
  }
  const durationRaw = Number(parsed.format?.duration) || Number(videoStream?.duration) || 0;
  if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
    throw new Error("Could not determine video duration. Please check that the file is not corrupted.");
  }
  let fps = 30;
  if (videoStream?.r_frame_rate && typeof videoStream.r_frame_rate === "string") {
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (num > 0 && den > 0) {
      fps = Math.round(num / den * 100) / 100;
    }
  }
  return {
    durationSec: Math.max(0.5, Math.round(durationRaw * 100) / 100),
    width: Number(videoStream?.width) || 1280,
    height: Number(videoStream?.height) || 720,
    fps,
    hasAudio: Boolean(audioStream),
    sizeBytes: stat.size,
    codec: String(videoStream?.codec_name || "h264")
  };
}
async function extractTimelineThumbnails(filePath, outDir, durationSec, count = 12) {
  fs.mkdirSync(outDir, { recursive: true });
  const safeCount = Math.max(1, Math.min(16, count));
  const step = durationSec / safeCount;
  const jobs = Array.from({ length: safeCount }, async (_, idx) => {
    const timestamp = Math.min(Math.max(0, idx * step + step * 0.25), Math.max(0, durationSec - 0.1));
    const filename = `thumb_${String(idx + 1).padStart(3, "0")}.jpg`;
    const outFile = path.join(outDir, filename);
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        timestamp.toFixed(2),
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=192:-2",
        "-q:v",
        "5",
        outFile
      ]);
    } catch {
    }
  });
  await Promise.all(jobs);
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".jpg")).sort();
  return files;
}
async function generateSampleVideo(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const cachePath = path.resolve(process.cwd(), "tmp_studio", "sample-cache.mp4");
  if (fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, outPath);
    return;
  }
  const filterComplex = [
    // Scene 1 (0-5.5s): Dynamic animated pattern + emerald studio framing
    "testsrc2=size=640x360:rate=24:duration=5.5,scale=1280:720:flags=fast_bilinear,drawbox=x=40:y=40:w=1200:h=640:color=#10B981@0.8:t=6[v0]",
    // Scene 2 (5.5-8.5s): Static muted gray "boring pause / dead air"
    "color=c=#1C2128:s=1280x720:d=3.0:r=24,drawbox=x=540:y=340:w=200:h=40:color=#475569@0.4:t=fill[v1]",
    // Scene 3 (8.5-14s): Bright color bars with sky-blue frame
    "smptehdbars=size=640x360:rate=24:duration=5.5,scale=1280:720:flags=fast_bilinear,drawbox=x=40:y=40:w=1200:h=640:color=#0EA5E9@0.8:t=6[v2]",
    "[v0][v1][v2]concat=n=3:v=1:a=0[vout]",
    // Audio: lively synth arpeggio in scene 1, near silence in scene 2, upbeat chord in scene 3
    "aevalsrc=0.14*sin(2*PI*220*t)*sin(2*PI*2*t)+0.08*sin(2*PI*440*t):s=44100:d=5.5[a0]",
    "aevalsrc=0.002*sin(2*PI*60*t):s=44100:d=3.0[a1]",
    "aevalsrc=0.15*sin(2*PI*293.66*t)+0.10*sin(2*PI*440*t)+0.08*sin(2*PI*587.33*t):s=44100:d=5.5[a2]",
    "[a0][a1][a2]concat=n=3:v=0:a=1[aout]"
  ].join(";");
  await execFileAsync("ffmpeg", [
    "-y",
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    cachePath
  ]);
  fs.copyFileSync(cachePath, outPath);
}
async function ensureMusicTrack(preset, outPath, durationSec = 16) {
  if (preset === "none") return null;
  if (fs.existsSync(outPath)) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const sampleRate = 44100;
  const channels = 2;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataSize = totalSamples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  const chordProgression = {
    "upbeat-tech": [
      [220, 261.63, 329.63],
      // Am
      [174.61, 220, 261.63],
      // F
      [261.63, 329.63, 392],
      // C
      [196, 246.94, 293.66]
      // G
    ],
    "chill-ambient": [
      [196, 246.94, 293.66, 369.99],
      // Gmaj7
      [164.81, 196, 246.94, 293.66],
      // Em7
      [130.81, 164.81, 196, 246.94],
      // Cmaj7
      [146.83, 185, 220, 261.63]
      // D7
    ],
    "cinematic-pulse": [
      [110, 164.81, 220, 261.63],
      [98, 146.83, 196, 246.94],
      [87.31, 130.81, 174.61, 220],
      [82.41, 123.47, 164.81, 207.65]
    ],
    "gaming-synth": [
      [261.63, 329.63, 392, 523.25],
      [220, 261.63, 329.63, 440],
      [174.61, 220, 261.63, 349.23],
      [196, 246.94, 293.66, 392]
    ]
  };
  const chords = chordProgression[preset];
  const barDur = 2;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const barIdx = Math.floor(t / barDur) % chords.length;
    const notes = chords[barIdx];
    let pad = 0;
    for (let n = 0; n < notes.length; n++) {
      const f = notes[n];
      pad += Math.sin(2 * Math.PI * f * t) * (n === 0 ? 0.22 : 0.13);
    }
    let beat = 0;
    if (preset === "upbeat-tech") {
      const pulse = Math.exp(-5 * (t % 0.5));
      beat = Math.sin(2 * Math.PI * (notes[0] * 0.5) * t) * 0.24 * pulse;
    } else if (preset === "cinematic-pulse") {
      const pulse = Math.exp(-3.5 * (t % 0.75));
      beat = Math.sin(2 * Math.PI * (notes[0] * 0.5) * t) * 0.28 * pulse;
    } else if (preset === "gaming-synth") {
      const step = Math.floor(t * 8) % notes.length;
      const arpEnv = Math.exp(-8 * (t % 0.125));
      beat = Math.sin(2 * Math.PI * notes[step] * 2 * t) * 0.16 * arpEnv;
    }
    const fadeIn = Math.min(1, t / 0.25);
    const fadeOut = Math.min(1, (durationSec - t) / 0.25);
    const env = fadeIn * fadeOut;
    const sampleL = Math.max(-0.95, Math.min(0.95, (pad + beat) * env * 0.65));
    const sampleR = Math.max(
      -0.95,
      Math.min(0.95, (pad * (0.92 + 0.08 * Math.sin(t * 0.8)) + beat) * env * 0.65)
    );
    const offset = 44 + i * 4;
    buffer.writeInt16LE(Math.round(sampleL * 32767), offset);
    buffer.writeInt16LE(Math.round(sampleR * 32767), offset + 2);
  }
  fs.writeFileSync(outPath, buffer);
  return outPath;
}
function computeKeptRanges(durationSec, cuts) {
  const approved = cuts.filter((c) => c.approved && c.endSec > c.startSec).map((c) => ({
    startSec: Math.max(0, Math.min(durationSec, c.startSec)),
    endSec: Math.max(0, Math.min(durationSec, c.endSec))
  })).sort((a, b) => a.startSec - b.startSec);
  const merged = [];
  for (const cut of approved) {
    if (merged.length === 0) {
      merged.push({ ...cut });
    } else {
      const last = merged[merged.length - 1];
      if (cut.startSec <= last.endSec + 0.05) {
        last.endSec = Math.max(last.endSec, cut.endSec);
      } else {
        merged.push({ ...cut });
      }
    }
  }
  const kept = [];
  let cursor = 0;
  for (const cut of merged) {
    if (cut.startSec - cursor > 0.2) {
      kept.push({ startSec: cursor, endSec: cut.startSec });
    }
    cursor = Math.max(cursor, cut.endSec);
  }
  if (durationSec - cursor > 0.2) {
    kept.push({ startSec: cursor, endSec: durationSec });
  }
  if (kept.length === 0) {
    return [{ startSec: 0, endSec: durationSec }];
  }
  return kept;
}
async function renderFinalVideo(opts) {
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  const kept = computeKeptRanges(opts.metadata.durationSec, opts.cuts);
  const cutsApplied = opts.cuts.filter((c) => c.approved).length;
  const targetHeight = opts.quality === "1080p" ? 1080 : 720;
  const isPortrait = opts.metadata.height > opts.metadata.width;
  const scaleExpr = isPortrait ? `scale=-2:${targetHeight}` : `scale=-2:${targetHeight}`;
  const filters = [];
  const inputs = ["-i", opts.inputPath];
  let musicInputIdx = -1;
  let voiceInputIdx = -1;
  let nextInputIdx = 1;
  if (opts.musicPath && fs.existsSync(opts.musicPath) && opts.musicVolume > 0.01) {
    inputs.push("-stream_loop", "-1", "-i", opts.musicPath);
    musicInputIdx = nextInputIdx++;
  }
  if (opts.voiceoverPath && fs.existsSync(opts.voiceoverPath) && opts.voiceoverVolume > 0.01) {
    inputs.push("-i", opts.voiceoverPath);
    voiceInputIdx = nextInputIdx++;
  }
  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const start = seg.startSec.toFixed(3);
    const end = seg.endSec.toFixed(3);
    let vFilter = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scaleExpr},setsar=1`;
    if (opts.colorGrade === "cinematic") {
      vFilter += ",eq=contrast=1.08:saturation=1.16:brightness=0.01";
    } else if (opts.colorGrade === "vibrant") {
      vFilter += ",eq=contrast=1.06:saturation=1.32:brightness=0.02";
    } else if (opts.colorGrade === "crisp") {
      vFilter += ",eq=contrast=1.12:saturation=1.08:brightness=0.02";
    }
    if (opts.zoom === "punch" && i % 2 === 1) {
      vFilter += ",scale=iw*1.10:ih*1.10,crop=iw/1.10:ih/1.10";
    } else if (opts.zoom === "kenburns") {
      vFilter += ",scale=trunc(iw*1.08/2)*2:trunc(ih*1.08/2)*2,crop=trunc(iw/1.08/2)*2:trunc(ih/1.08/2)*2:(iw-ow)/2+(iw-ow)/4*sin(t*0.8):(ih-oh)/2";
    }
    vFilter += `,fps=30,format=yuv420p[v${i}]`;
    filters.push(vFilter);
    if (opts.metadata.hasAudio) {
      filters.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a${i}]`
      );
    }
  }
  let totalDuration = kept.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
  const canXfade = opts.transition !== "none" && kept.length > 1 && kept.every((s) => s.endSec - s.startSec >= 0.9);
  if (kept.length === 1) {
    filters.push("[v0]null[vjoined]");
    if (opts.metadata.hasAudio) {
      filters.push("[a0]anull[aorig]");
    }
  } else if (canXfade) {
    const fadeDur = 0.35;
    const xfadeType = opts.transition === "flash" ? "fadewhite" : opts.transition === "fade" ? "fadeblack" : "fade";
    let currentV = "[v0]";
    let currentA = "[a0]";
    let runningOffset = kept[0].endSec - kept[0].startSec - fadeDur;
    for (let i = 1; i < kept.length; i++) {
      const outV = i === kept.length - 1 ? "[vjoined]" : `[vx${i}]`;
      filters.push(
        `${currentV}[v${i}]xfade=transition=${xfadeType}:duration=${fadeDur}:offset=${Math.max(0.1, runningOffset).toFixed(3)}${outV}`
      );
      currentV = outV;
      if (opts.metadata.hasAudio) {
        const outA = i === kept.length - 1 ? "[aorig]" : `[ax${i}]`;
        filters.push(`${currentA}[a${i}]acrossfade=d=${fadeDur}${outA}`);
        currentA = outA;
      }
      runningOffset += kept[i].endSec - kept[i].startSec - fadeDur;
    }
    totalDuration = Math.max(0.5, totalDuration - fadeDur * (kept.length - 1));
  } else {
    const vInputs = kept.map((_, i) => `[v${i}]`).join("");
    filters.push(`${vInputs}concat=n=${kept.length}:v=1:a=0[vjoined]`);
    if (opts.metadata.hasAudio) {
      const aInputs = kept.map((_, i) => `[a${i}]`).join("");
      filters.push(`${aInputs}concat=n=${kept.length}:v=0:a=1[aorig]`);
    }
  }
  if (opts.transition !== "none" && totalDuration > 1.2) {
    filters.push(
      `[vjoined]fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0.3, totalDuration - 0.3).toFixed(3)}:d=0.3[vfinal]`
    );
  } else {
    filters.push("[vjoined]null[vfinal]");
  }
  const audioStreamsToMix = [];
  if (opts.metadata.hasAudio && opts.originalAudioVolume > 0.01) {
    filters.push(
      `[aorig]volume=${opts.originalAudioVolume.toFixed(2)},atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[amix_orig]`
    );
    audioStreamsToMix.push("[amix_orig]");
  }
  if (musicInputIdx !== -1) {
    filters.push(
      `[${musicInputIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${opts.musicVolume.toFixed(2)},atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${Math.max(0.2, totalDuration - 0.5).toFixed(3)}:d=0.5,asetpts=PTS-STARTPTS[amix_music]`
    );
    audioStreamsToMix.push("[amix_music]");
  }
  if (voiceInputIdx !== -1) {
    filters.push(
      `[${voiceInputIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${opts.voiceoverVolume.toFixed(2)},apad=whole_dur=${totalDuration.toFixed(3)},atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[amix_voice]`
    );
    audioStreamsToMix.push("[amix_voice]");
  }
  let hasFinalAudio = false;
  if (audioStreamsToMix.length === 1) {
    filters.push(`${audioStreamsToMix[0]}anull[afinal]`);
    hasFinalAudio = true;
  } else if (audioStreamsToMix.length > 1) {
    filters.push(
      `${audioStreamsToMix.join("")}amix=inputs=${audioStreamsToMix.length}:duration=longest:dropout_transition=2:normalize=0[afinal]`
    );
    hasFinalAudio = true;
  }
  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vfinal]",
    ...hasFinalAudio ? ["-map", "[afinal]", "-c:a", "aac", "-b:a", "192k"] : ["-an"],
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-t",
    totalDuration.toFixed(3),
    opts.outPath
  ];
  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 32 });
  return {
    editedDurationSec: Math.round(totalDuration * 100) / 100,
    cutsApplied
  };
}

// server.ts
var MAX_VIDEO_SIZE_BYTES = 750 * 1024 * 1024;
var MAX_VIDEO_DURATION_SEC = 905;
var CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".mp4", ".mov", ".webm"]);
var ALLOWED_MIME_TYPES = /* @__PURE__ */ new Set(["video/mp4", "video/quicktime", "video/webm"]);
function resolveVideoFormat(originalName, reportedMime) {
  const ext = path2.extname(originalName || "").toLowerCase();
  const mime = (reportedMime || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    if (ext === ".mov") return { ext: ".mov", mimeType: "video/quicktime" };
    if (ext === ".webm") return { ext: ".webm", mimeType: "video/webm" };
    return { ext: ".mp4", mimeType: "video/mp4" };
  }
  if (ALLOWED_MIME_TYPES.has(mime)) {
    if (mime === "video/quicktime") return { ext: ".mov", mimeType: "video/quicktime" };
    if (mime === "video/webm") return { ext: ".webm", mimeType: "video/webm" };
    return { ext: ".mp4", mimeType: "video/mp4" };
  }
  return null;
}
var WORKSPACE_DIR = path2.resolve(process.cwd(), "tmp_studio");
var UPLOADS_DIR = path2.join(WORKSPACE_DIR, "uploads");
var PROJECTS_DIR = path2.join(WORKSPACE_DIR, "projects");
var MUSIC_DIR = path2.join(WORKSPACE_DIR, "music");
fs2.mkdirSync(UPLOADS_DIR, { recursive: true });
fs2.mkdirSync(PROJECTS_DIR, { recursive: true });
fs2.mkdirSync(MUSIC_DIR, { recursive: true });
var projects = /* @__PURE__ */ new Map();
var uploadSessions = /* @__PURE__ */ new Map();
function saveProjectManifest(record) {
  const manifestPath = path2.join(PROJECTS_DIR, record.id, "project.json");
  const serializable = {
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    videoPath: record.videoPath,
    thumbDir: record.thumbDir,
    thumbnails: record.thumbnails,
    metadata: record.metadata,
    geminiFileUri: record.geminiFileUri,
    geminiMimeType: record.geminiMimeType,
    voiceoverPath: record.voiceoverPath,
    exportPath: record.exportPath,
    isSample: record.isSample
  };
  fs2.mkdirSync(path2.dirname(manifestPath), { recursive: true });
  fs2.writeFileSync(manifestPath, JSON.stringify(serializable, null, 2));
}
function loadExistingProjects() {
  if (!fs2.existsSync(PROJECTS_DIR)) return;
  for (const dirName of fs2.readdirSync(PROJECTS_DIR)) {
    const manifestPath = path2.join(PROJECTS_DIR, dirName, "project.json");
    if (fs2.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
        if (parsed?.id && parsed?.videoPath && fs2.existsSync(parsed.videoPath)) {
          projects.set(parsed.id, parsed);
        }
      } catch {
      }
    }
  }
}
loadExistingProjects();
var storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const resolved = resolveVideoFormat(file.originalname, file.mimetype);
    const ext = resolved?.ext || path2.extname(file.originalname || "").toLowerCase() || ".mp4";
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
var upload = multer({
  storage,
  limits: {
    fileSize: MAX_VIDEO_SIZE_BYTES
  },
  fileFilter: (_req, file, cb) => {
    const resolved = resolveVideoFormat(file.originalname, file.mimetype);
    if (!resolved) {
      cb(new Error("Unsupported video format. Please upload an MP4, MOV, or WebM video."));
      return;
    }
    cb(null, true);
  }
});
function extractReadableErrorMessage(raw) {
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
    }
  }
  return raw;
}
function formatApiError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return { status: 413, message: "Video exceeds the 750 MB maximum file size limit." };
    }
    return { status: 400, message: err.message || "Invalid file upload request." };
  }
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = extractReadableErrorMessage(rawMsg);
  if (msg.includes("Unsupported video format") || msg.includes("10,000-byte")) {
    return { status: 400, message: msg };
  }
  if (rawMsg.includes("INVALID_ARGUMENT") || rawMsg.includes('"code":400')) {
    return { status: 400, message: msg || "Invalid request parameters for AI generation." };
  }
  if (rawMsg.includes("API_KEY_INVALID") || rawMsg.includes("PERMISSION_DENIED") || rawMsg.includes("403")) {
    return {
      status: 403,
      message: "Gemini API key error. Please verify GEMINI_API_KEY in Settings > Secrets."
    };
  }
  if (rawMsg.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("429")) {
    return {
      status: 429,
      message: "Gemini API rate limit reached. Please wait a moment and try again."
    };
  }
  if (rawMsg.includes("503") || rawMsg.includes("UNAVAILABLE") || rawMsg.includes("high demand")) {
    return {
      status: 503,
      message: "AI model is experiencing temporary high demand. Please try again in a few seconds."
    };
  }
  return { status: 500, message: msg || "Internal server error" };
}
async function ensureGeminiFile(project) {
  if (project.geminiFileUri && project.geminiMimeType) {
    return { fileUri: project.geminiFileUri, mimeType: project.geminiMimeType };
  }
  if (!project.geminiUploadPromise) {
    project.geminiUploadPromise = uploadVideoToGemini(project.videoPath, project.mimeType).then((res) => {
      project.geminiFileUri = res.fileUri;
      project.geminiMimeType = res.mimeType;
      saveProjectManifest(project);
      return { fileUri: res.fileUri, mimeType: res.mimeType };
    }).catch((err) => {
      project.geminiUploadPromise = void 0;
      throw err;
    });
  }
  return project.geminiUploadPromise;
}
function streamRangeFile(req, res, filePath, contentType) {
  if (!fs2.existsSync(filePath)) {
    res.status(404).json({ error: "Media file not found." });
    return;
  }
  const stat = fs2.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType
    });
    fs2.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs2.createReadStream(filePath).pipe(res);
  }
}
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  async function finalizeUploadedVideo(filePath, originalName, mimeType) {
    const id = crypto.randomUUID();
    const projectDir = path2.join(PROJECTS_DIR, id);
    const thumbDir = path2.join(projectDir, "thumbs");
    fs2.mkdirSync(projectDir, { recursive: true });
    let metadata;
    try {
      metadata = await probeVideo(filePath);
    } catch (err) {
      if (fs2.existsSync(filePath)) fs2.unlinkSync(filePath);
      fs2.rmSync(projectDir, { recursive: true, force: true });
      throw err;
    }
    if (metadata.durationSec > MAX_VIDEO_DURATION_SEC) {
      if (fs2.existsSync(filePath)) fs2.unlinkSync(filePath);
      fs2.rmSync(projectDir, { recursive: true, force: true });
      throw Object.assign(
        new Error(
          `Video is ${(metadata.durationSec / 60).toFixed(1)} minutes long. Maximum supported length is 15 minutes.`
        ),
        { statusCode: 400 }
      );
    }
    const ext = path2.extname(filePath) || ".mp4";
    const storedVideoPath = path2.join(projectDir, `source${ext}`);
    fs2.renameSync(filePath, storedVideoPath);
    const thumbnails = await extractTimelineThumbnails(
      storedVideoPath,
      thumbDir,
      metadata.durationSec,
      12
    );
    const record = {
      id,
      originalName: originalName || `uploaded-video${ext}`,
      mimeType,
      videoPath: storedVideoPath,
      thumbDir,
      thumbnails,
      metadata
    };
    projects.set(id, record);
    saveProjectManifest(record);
    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      videoUrl: `/api/videos/${record.id}/stream`,
      thumbnails: record.thumbnails.map((f) => `/api/videos/${record.id}/thumbnails/${f}`),
      metadata: record.metadata,
      geminiReady: false
    };
  }
  app.post("/api/videos/upload/init", (req, res) => {
    try {
      const fileName = String(req.body?.fileName || "");
      const mimeType = String(req.body?.mimeType || "");
      const fileSize = Number(req.body?.fileSize || 0);
      if (!fileName) {
        res.status(400).json({ error: "Missing file name." });
        return;
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        res.status(400).json({ error: "Selected video file is empty." });
        return;
      }
      if (fileSize > MAX_VIDEO_SIZE_BYTES) {
        res.status(413).json({
          error: "Video file exceeds the 750 MB limit. Please upload a smaller file."
        });
        return;
      }
      const resolved = resolveVideoFormat(fileName, mimeType);
      if (!resolved) {
        res.status(400).json({
          error: "Unsupported video format. Please upload an MP4, MOV, or WebM video."
        });
        return;
      }
      const uploadId = crypto.randomUUID();
      const tempPath = path2.join(UPLOADS_DIR, `${uploadId}${resolved.ext}`);
      fs2.writeFileSync(tempPath, Buffer.alloc(0));
      uploadSessions.set(uploadId, {
        uploadId,
        originalName: fileName,
        mimeType: resolved.mimeType,
        ext: resolved.ext,
        expectedSize: fileSize,
        receivedBytes: 0,
        tempPath,
        createdAt: Date.now()
      });
      res.json({
        uploadId,
        chunkSize: CHUNK_SIZE_BYTES
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post(
    "/api/videos/upload/chunk",
    express.raw({ type: "application/octet-stream", limit: "16mb" }),
    (req, res) => {
      try {
        const uploadId = String(req.headers["x-upload-id"] || "");
        const session = uploadSessions.get(uploadId);
        if (!session) {
          res.status(404).json({ error: "Upload session expired or not found." });
          return;
        }
        const chunkBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (chunkBuffer.length === 0) {
          res.status(400).json({ error: "Empty upload chunk received." });
          return;
        }
        if (session.receivedBytes + chunkBuffer.length > MAX_VIDEO_SIZE_BYTES) {
          if (fs2.existsSync(session.tempPath)) fs2.unlinkSync(session.tempPath);
          uploadSessions.delete(uploadId);
          res.status(413).json({ error: "Video file exceeds the 750 MB limit." });
          return;
        }
        fs2.appendFileSync(session.tempPath, chunkBuffer);
        session.receivedBytes += chunkBuffer.length;
        res.json({
          uploadId,
          receivedBytes: session.receivedBytes
        });
      } catch (err) {
        const { status, message } = formatApiError(err);
        res.status(status).json({ error: message });
      }
    }
  );
  app.post("/api/videos/upload/complete", async (req, res) => {
    try {
      const uploadId = String(req.body?.uploadId || "");
      const session = uploadSessions.get(uploadId);
      if (!session) {
        res.status(404).json({ error: "Upload session not found." });
        return;
      }
      uploadSessions.delete(uploadId);
      if (!fs2.existsSync(session.tempPath)) {
        res.status(400).json({ error: "Uploaded video file is missing on server." });
        return;
      }
      const actualSize = fs2.statSync(session.tempPath).size;
      if (actualSize !== session.expectedSize) {
        fs2.unlinkSync(session.tempPath);
        res.status(400).json({
          error: `Upload incomplete (${actualSize} of ${session.expectedSize} bytes received). Please try again.`
        });
        return;
      }
      const projectDto = await finalizeUploadedVideo(
        session.tempPath,
        session.originalName,
        session.mimeType
      );
      res.json(projectDto);
    } catch (err) {
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : formatApiError(err).status;
      const message = err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });
  app.post("/api/videos/upload", upload.single("video"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No video file provided." });
        return;
      }
      const resolved = resolveVideoFormat(req.file.originalname, req.file.mimetype);
      if (!resolved) {
        if (fs2.existsSync(req.file.path)) fs2.unlinkSync(req.file.path);
        res.status(400).json({
          error: "Unsupported video format. Please upload an MP4, MOV, or WebM video."
        });
        return;
      }
      const projectDto = await finalizeUploadedVideo(
        req.file.path,
        req.file.originalname,
        resolved.mimeType
      );
      res.json(projectDto);
    } catch (err) {
      if (req.file?.path && fs2.existsSync(req.file.path)) {
        fs2.unlinkSync(req.file.path);
      }
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : formatApiError(err).status;
      const message = err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });
  app.post("/api/videos/sample", async (_req, res) => {
    try {
      const id = crypto.randomUUID();
      const projectDir = path2.join(PROJECTS_DIR, id);
      const thumbDir = path2.join(projectDir, "thumbs");
      const samplePath = path2.join(projectDir, "sample-studio-clip.mp4");
      fs2.mkdirSync(projectDir, { recursive: true });
      await generateSampleVideo(samplePath);
      const metadata = await probeVideo(samplePath);
      const thumbnails = await extractTimelineThumbnails(
        samplePath,
        thumbDir,
        metadata.durationSec,
        12
      );
      const record = {
        id,
        originalName: "creator-studio-sample.mp4",
        mimeType: "video/mp4",
        videoPath: samplePath,
        thumbDir,
        thumbnails,
        metadata,
        isSample: true
      };
      projects.set(id, record);
      saveProjectManifest(record);
      res.json({
        id: record.id,
        originalName: record.originalName,
        mimeType: record.mimeType,
        videoUrl: `/api/videos/${record.id}/stream`,
        thumbnails: record.thumbnails.map((f) => `/api/videos/${record.id}/thumbnails/${f}`),
        metadata: record.metadata,
        geminiReady: false,
        isSample: true
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.get("/api/videos/:id/stream", (req, res) => {
    const project = projects.get(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    streamRangeFile(req, res, project.videoPath, project.mimeType || "video/mp4");
  });
  app.get("/api/videos/:id/thumbnails/:file", (req, res) => {
    const project = projects.get(req.params.id);
    if (!project) {
      res.status(404).end();
      return;
    }
    const safeName = path2.basename(req.params.file);
    const thumbPath = path2.join(project.thumbDir, safeName);
    if (!fs2.existsSync(thumbPath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(thumbPath);
  });
  app.post("/api/videos/:id/analyze", async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const { fileUri, mimeType } = await ensureGeminiFile(project);
      const analysis = await analyzeVideoWithGemini(
        fileUri,
        mimeType,
        project.metadata.durationSec
      );
      res.json({ analysis, geminiReady: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post("/api/videos/:id/script", async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const style = req.body?.style || "youtube";
      const length = req.body?.length || "medium";
      const language = req.body?.language || "en";
      const cuts = Array.isArray(req.body?.cuts) ? req.body.cuts : [];
      const kept = computeKeptRanges(project.metadata.durationSec, cuts);
      const editedDurationSec = kept.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
      const { fileUri, mimeType } = await ensureGeminiFile(project);
      const script = await generateScriptWithGemini(
        fileUri,
        mimeType,
        project.metadata.durationSec,
        editedDurationSec,
        style,
        length,
        language
      );
      res.json({ script, geminiReady: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post("/api/videos/:id/voiceover", async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const text = String(req.body?.text || "").trim();
      const voiceId = req.body?.voiceId || "Kore";
      const language = req.body?.language || "en";
      if (!text) {
        res.status(400).json({ error: "Script text cannot be empty." });
        return;
      }
      const wavBuffer = await generateVoiceoverWithGemini(text, voiceId, language);
      const projectDir = path2.join(WORKSPACE_DIR, "projects", project.id);
      fs2.mkdirSync(projectDir, { recursive: true });
      const voPath = path2.join(projectDir, "voiceover.wav");
      fs2.writeFileSync(voPath, wavBuffer);
      project.voiceoverPath = voPath;
      saveProjectManifest(project);
      const pcmBytes = Math.max(0, wavBuffer.length - 44);
      const durationHintSec = Math.round(pcmBytes / 48e3 * 10) / 10;
      res.json({
        voiceover: {
          audioUrl: `/api/videos/${project.id}/voiceover/audio?t=${Date.now()}`,
          voiceId,
          language,
          durationHintSec,
          sizeBytes: wavBuffer.length
        }
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.get("/api/videos/:id/voiceover/audio", (req, res) => {
    const project = projects.get(req.params.id);
    if (!project || !project.voiceoverPath || !fs2.existsSync(project.voiceoverPath)) {
      res.status(404).json({ error: "Voiceover audio not found." });
      return;
    }
    streamRangeFile(req, res, project.voiceoverPath, "audio/wav");
  });
  app.get("/api/music/:preset", async (req, res) => {
    try {
      const preset = req.params.preset;
      const valid = [
        "upbeat-tech",
        "chill-ambient",
        "cinematic-pulse",
        "gaming-synth"
      ];
      if (!valid.includes(preset)) {
        res.status(404).json({ error: "Music preset not found." });
        return;
      }
      const trackPath = path2.join(MUSIC_DIR, `${preset}.wav`);
      await ensureMusicTrack(preset, trackPath, 16);
      streamRangeFile(req, res, trackPath, "audio/wav");
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post("/api/videos/:id/export", async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      const cuts = Array.isArray(req.body?.cuts) ? req.body.cuts : [];
      const settings = req.body?.settings || {};
      const includeVoiceover = Boolean(req.body?.includeVoiceover);
      const musicPreset = settings.music || "none";
      let musicPath = null;
      if (musicPreset !== "none") {
        const candidate = path2.join(MUSIC_DIR, `${musicPreset}.wav`);
        musicPath = await ensureMusicTrack(musicPreset, candidate, 16);
      }
      const projectDir = path2.join(WORKSPACE_DIR, "projects", project.id);
      const outPath = path2.join(projectDir, "cutflow-export.mp4");
      const renderStats = await renderFinalVideo({
        inputPath: project.videoPath,
        outPath,
        metadata: project.metadata,
        cuts,
        transition: settings.transition || "crossfade",
        zoom: settings.zoom || "off",
        colorGrade: settings.colorGrade || "original",
        musicPath,
        voiceoverPath: includeVoiceover ? project.voiceoverPath || null : null,
        originalAudioVolume: typeof settings.originalAudioVolume === "number" ? settings.originalAudioVolume : 1,
        musicVolume: typeof settings.musicVolume === "number" ? settings.musicVolume : 0.28,
        voiceoverVolume: typeof settings.voiceoverVolume === "number" ? settings.voiceoverVolume : 1,
        quality: settings.exportQuality === "1080p" ? "1080p" : "720p"
      });
      project.exportPath = outPath;
      saveProjectManifest(project);
      const stat = fs2.statSync(outPath);
      const baseName = path2.parse(project.originalName).name;
      res.json({
        exportResult: {
          downloadUrl: `/api/videos/${project.id}/export/download?t=${Date.now()}`,
          filename: `${baseName}-cutflow-edited.mp4`,
          sizeBytes: stat.size,
          editedDurationSec: renderStats.editedDurationSec,
          cutsApplied: renderStats.cutsApplied
        }
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.get("/api/videos/:id/export/download", (req, res) => {
    const project = projects.get(req.params.id);
    if (!project || !project.exportPath || !fs2.existsSync(project.exportPath)) {
      res.status(404).json({ error: "Exported video not found." });
      return;
    }
    const baseName = path2.parse(project.originalName).name;
    res.download(project.exportPath, `${baseName}-cutflow-edited.mp4`);
  });
  app.use(
    "/api",
    (err, _req, res, _next) => {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  );
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path2.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distDir, "index.html"));
    });
  }
  const PORT = Number(process.env.PORT) || 3e3;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CutFlow Studio server listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
