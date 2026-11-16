import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ColorGradePreset,
  CutSuggestion,
  MusicPreset,
  TransitionPreset,
  VideoMetadata,
  ZoomPreset,
} from '../src/types/studio.js';

const execFileAsync = promisify(execFile);

export interface TimeRange {
  startSec: number;
  endSec: number;
}

export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  const stat = fs.statSync(filePath);
  let stdout = '';
  try {
    const res = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    stdout = res.stdout;
  } catch {
    throw new Error('Could not read video file. Please upload a valid MP4, MOV, or WebM video.');
  }

  const parsed = JSON.parse(stdout || '{}');
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'video');
  const audioStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('No valid video track found in the uploaded file.');
  }

  const durationRaw =
    Number(parsed.format?.duration) ||
    Number(videoStream?.duration) ||
    0;

  if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
    throw new Error('Could not determine video duration. Please check that the file is not corrupted.');
  }

  let fps = 30;
  if (videoStream?.r_frame_rate && typeof videoStream.r_frame_rate === 'string') {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (num > 0 && den > 0) {
      fps = Math.round((num / den) * 100) / 100;
    }
  }

  return {
    durationSec: Math.max(0.5, Math.round(durationRaw * 100) / 100),
    width: Number(videoStream?.width) || 1280,
    height: Number(videoStream?.height) || 720,
    fps,
    hasAudio: Boolean(audioStream),
    sizeBytes: stat.size,
    codec: String(videoStream?.codec_name || 'h264'),
  };
}

export async function detectAudioSilences(
  filePath: string,
  hasAudio: boolean
): Promise<TimeRange[]> {
  if (!hasAudio) return [];
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-i',
        filePath,
        '-vn',
        '-af',
        'silencedetect=noise=-36dB:d=1.1',
        '-f',
        'null',
        '-',
      ],
      { maxBuffer: 1024 * 1024 * 16, timeout: 45000 }
    );

    const ranges: TimeRange[] = [];
    let currentStart: number | null = null;
    const lines = stderr.split(/\r?\n/);

    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
      if (startMatch) {
        const val = Number(startMatch[1]);
        if (Number.isFinite(val)) currentStart = Math.max(0, val);
        continue;
      }
      const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
      if (endMatch && currentStart !== null) {
        const endVal = Number(endMatch[1]);
        if (Number.isFinite(endVal) && endVal - currentStart >= 1.0) {
          ranges.push({
            startSec: Math.round(currentStart * 10) / 10,
            endSec: Math.round(endVal * 10) / 10,
          });
        }
        currentStart = null;
      }
    }
    return ranges.slice(0, 30);
  } catch {
    return [];
  }
}

export async function extractTimelineThumbnails(
  filePath: string,
  outDir: string,
  durationSec: number,
  count = 12
): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const safeCount = Math.max(1, Math.min(16, count));
  const step = durationSec / safeCount;

  // Use fast input seeking (-ss before -i) so even 15-minute 4K videos extract thumbnails in ~1-2 seconds.
  const jobs = Array.from({ length: safeCount }, async (_, idx) => {
    const timestamp = Math.min(Math.max(0, idx * step + step * 0.25), Math.max(0, durationSec - 0.1));
    const filename = `thumb_${String(idx + 1).padStart(3, '0')}.jpg`;
    const outFile = path.join(outDir, filename);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss',
        timestamp.toFixed(2),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=192:-2',
        '-q:v',
        '5',
        outFile,
      ]);
    } catch {
      // Skip individual frame extraction errors near EOF
    }
  });

  await Promise.all(jobs);

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  return files;
}

export async function generateSampleVideo(outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const cachePath = path.resolve(process.cwd(), 'tmp_studio', 'sample-cache.mp4');
  if (fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, outPath);
    return;
  }

  // Create a fast 14-second multi-scene sample video (1280x720, 24fps) with distinct scenes
  // and a quiet "dead air" middle gap from ~5.5s to ~8.5s for AI auto-cut detection.
  const filterComplex = [
    // Scene 1 (0-5.5s): Dynamic animated pattern + emerald studio framing
    'testsrc2=size=640x360:rate=24:duration=5.5,scale=1280:720:flags=fast_bilinear,drawbox=x=40:y=40:w=1200:h=640:color=#10B981@0.8:t=6[v0]',
    // Scene 2 (5.5-8.5s): Static muted gray "boring pause / dead air"
    'color=c=#1C2128:s=1280x720:d=3.0:r=24,drawbox=x=540:y=340:w=200:h=40:color=#475569@0.4:t=fill[v1]',
    // Scene 3 (8.5-14s): Bright color bars with sky-blue frame
    'smptehdbars=size=640x360:rate=24:duration=5.5,scale=1280:720:flags=fast_bilinear,drawbox=x=40:y=40:w=1200:h=640:color=#0EA5E9@0.8:t=6[v2]',
    '[v0][v1][v2]concat=n=3:v=1:a=0[vout]',
    // Audio: lively synth arpeggio in scene 1, near silence in scene 2, upbeat chord in scene 3
    'aevalsrc=0.14*sin(2*PI*220*t)*sin(2*PI*2*t)+0.08*sin(2*PI*440*t):s=44100:d=5.5[a0]',
    'aevalsrc=0.002*sin(2*PI*60*t):s=44100:d=3.0[a1]',
    'aevalsrc=0.15*sin(2*PI*293.66*t)+0.10*sin(2*PI*440*t)+0.08*sin(2*PI*587.33*t):s=44100:d=5.5[a2]',
    '[a0][a1][a2]concat=n=3:v=0:a=1[aout]',
  ].join(';');

  await execFileAsync('ffmpeg', [
    '-y',
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    cachePath,
  ]);
  fs.copyFileSync(cachePath, outPath);
}

export async function ensureMusicTrack(
  preset: MusicPreset,
  outPath: string,
  durationSec = 16
): Promise<string | null> {
  if (preset === 'none') return null;
  if (fs.existsSync(outPath)) return outPath;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const sampleRate = 44100;
  const channels = 2;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataSize = totalSamples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // Write standard 44-byte RIFF/WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const chordProgression: Record<Exclude<MusicPreset, 'none'>, number[][]> = {
    'upbeat-tech': [
      [220, 261.63, 329.63], // Am
      [174.61, 220, 261.63], // F
      [261.63, 329.63, 392.0], // C
      [196.0, 246.94, 293.66], // G
    ],
    'chill-ambient': [
      [196.0, 246.94, 293.66, 369.99], // Gmaj7
      [164.81, 196.0, 246.94, 293.66], // Em7
      [130.81, 164.81, 196.0, 246.94], // Cmaj7
      [146.83, 185.0, 220.0, 261.63], // D7
    ],
    'cinematic-pulse': [
      [110.0, 164.81, 220.0, 261.63],
      [98.0, 146.83, 196.0, 246.94],
      [87.31, 130.81, 174.61, 220.0],
      [82.41, 123.47, 164.81, 207.65],
    ],
    'gaming-synth': [
      [261.63, 329.63, 392.0, 523.25],
      [220.0, 261.63, 329.63, 440.0],
      [174.61, 220.0, 261.63, 349.23],
      [196.0, 246.94, 293.66, 392.0],
    ],
  };

  const chords = chordProgression[preset];
  const barDur = 2.0;

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
    if (preset === 'upbeat-tech') {
      const pulse = Math.exp(-5 * (t % 0.5));
      beat = Math.sin(2 * Math.PI * (notes[0] * 0.5) * t) * 0.24 * pulse;
    } else if (preset === 'cinematic-pulse') {
      const pulse = Math.exp(-3.5 * (t % 0.75));
      beat = Math.sin(2 * Math.PI * (notes[0] * 0.5) * t) * 0.28 * pulse;
    } else if (preset === 'gaming-synth') {
      const step = Math.floor(t * 8) % notes.length;
      const arpEnv = Math.exp(-8 * (t % 0.125));
      beat = Math.sin(2 * Math.PI * notes[step] * 2 * t) * 0.16 * arpEnv;
    }

    // Loop-friendly fade in/out
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

export function computeKeptRanges(
  durationSec: number,
  cuts: CutSuggestion[]
): TimeRange[] {
  const approved = cuts
    .filter((c) => c.approved && c.endSec > c.startSec)
    .map((c) => ({
      startSec: Math.max(0, Math.min(durationSec, c.startSec)),
      endSec: Math.max(0, Math.min(durationSec, c.endSec)),
    }))
    .sort((a, b) => a.startSec - b.startSec);

  // Merge overlapping cuts
  const merged: TimeRange[] = [];
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

  const kept: TimeRange[] = [];
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
    // Fallback: keep full video if user cut everything
    return [{ startSec: 0, endSec: durationSec }];
  }
  return kept;
}

export interface RenderExportOptions {
  inputPath: string;
  outPath: string;
  metadata: VideoMetadata;
  cuts: CutSuggestion[];
  transition: TransitionPreset;
  zoom: ZoomPreset;
  colorGrade: ColorGradePreset;
  musicPath: string | null;
  voiceoverPath: string | null;
  originalAudioVolume: number;
  musicVolume: number;
  voiceoverVolume: number;
  quality: '720p' | '1080p';
}

export async function renderFinalVideo(
  opts: RenderExportOptions
): Promise<{ editedDurationSec: number; cutsApplied: number }> {
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  const kept = computeKeptRanges(opts.metadata.durationSec, opts.cuts);
  const cutsApplied = opts.cuts.filter((c) => c.approved).length;

  const targetShort = opts.quality === '1080p' ? 1080 : 720;
  const srcW = Math.max(2, opts.metadata.width || 1280);
  const srcH = Math.max(2, opts.metadata.height || 720);
  const isPortrait = srcH > srcW;
  const rawTargetW = isPortrait
    ? targetShort
    : Math.round((srcW * targetShort) / srcH);
  const rawTargetH = isPortrait
    ? Math.round((srcH * targetShort) / srcW)
    : targetShort;
  const targetW = Math.max(2, Math.floor(rawTargetW / 2) * 2);
  const targetH = Math.max(2, Math.floor(rawTargetH / 2) * 2);
  const scaleExpr = `scale=${targetW}:${targetH}`;

  const filters: string[] = [];
  const inputs: string[] = ['-i', opts.inputPath];

  let musicInputIdx = -1;
  let voiceInputIdx = -1;
  let nextInputIdx = 1;

  if (opts.musicPath && fs.existsSync(opts.musicPath) && opts.musicVolume > 0.01) {
    inputs.push('-stream_loop', '-1', '-i', opts.musicPath);
    musicInputIdx = nextInputIdx++;
  }

  if (opts.voiceoverPath && fs.existsSync(opts.voiceoverPath) && opts.voiceoverVolume > 0.01) {
    inputs.push('-i', opts.voiceoverPath);
    voiceInputIdx = nextInputIdx++;
  }

  // 1. Trim kept video (& original audio if present)
  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const start = seg.startSec.toFixed(3);
    const end = seg.endSec.toFixed(3);

    let vFilter = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scaleExpr},setsar=1`;

    // Color grade
    if (opts.colorGrade === 'cinematic') {
      vFilter += ',eq=contrast=1.08:saturation=1.16:brightness=0.01';
    } else if (opts.colorGrade === 'vibrant') {
      vFilter += ',eq=contrast=1.06:saturation=1.32:brightness=0.02';
    } else if (opts.colorGrade === 'crisp') {
      vFilter += ',eq=contrast=1.12:saturation=1.08:brightness=0.02';
    }

    // Dynamic zoom (guaranteed exact targetW x targetH output for xfade/concat parity)
    if (opts.zoom === 'punch' && i % 2 === 1) {
      const zw = Math.ceil((targetW * 1.1) / 2) * 2;
      const zh = Math.ceil((targetH * 1.1) / 2) * 2;
      vFilter += `,scale=${zw}:${zh},crop=${targetW}:${targetH}`;
    } else if (opts.zoom === 'kenburns') {
      const zw = Math.ceil((targetW * 1.08) / 2) * 2;
      const zh = Math.ceil((targetH * 1.08) / 2) * 2;
      vFilter += `,scale=${zw}:${zh},crop=${targetW}:${targetH}:(iw-ow)/2+(iw-ow)/4*sin(t*0.8):(ih-oh)/2`;
    }

    // Ensure consistent fps, timebase (handles VFR mobile clips), & pixel format for xfade / concat
    vFilter += `,fps=30,settb=AVTB,format=yuv420p[v${i}]`;
    filters.push(vFilter);

    if (opts.metadata.hasAudio) {
      filters.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a${i}]`
      );
    }
  }

  // 2. Concatenate or xfade kept segments
  let totalDuration = kept.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
  const minSegDur = kept.reduce(
    (min, s) => Math.min(min, s.endSec - s.startSec),
    Infinity
  );
  const canXfade =
    opts.transition !== 'none' &&
    kept.length > 1 &&
    minSegDur >= 0.55;

  if (kept.length === 1) {
    filters.push('[v0]null[vjoined]');
    if (opts.metadata.hasAudio) {
      filters.push('[a0]anull[aorig]');
    }
  } else if (canXfade) {
    const fadeDur = Math.round(Math.min(0.35, minSegDur * 0.3) * 100) / 100;
    const xfadeType =
      opts.transition === 'flash'
        ? 'fadewhite'
        : opts.transition === 'fade'
          ? 'fadeblack'
          : 'fade';

    let currentV = '[v0]';
    let currentA = '[a0]';
    let runningOffset = kept[0].endSec - kept[0].startSec - fadeDur;

    for (let i = 1; i < kept.length; i++) {
      const outV = i === kept.length - 1 ? '[vjoined]' : `[vx${i}]`;
      filters.push(
        `${currentV}[v${i}]xfade=transition=${xfadeType}:duration=${fadeDur}:offset=${Math.max(0.1, runningOffset).toFixed(3)}${outV}`
      );
      currentV = outV;

      if (opts.metadata.hasAudio) {
        const outA = i === kept.length - 1 ? '[aorig]' : `[ax${i}]`;
        filters.push(`${currentA}[a${i}]acrossfade=d=${fadeDur}${outA}`);
        currentA = outA;
      }

      runningOffset += kept[i].endSec - kept[i].startSec - fadeDur;
    }
    totalDuration = Math.max(0.5, totalDuration - fadeDur * (kept.length - 1));
  } else {
    const vInputs = kept.map((_, i) => `[v${i}]`).join('');
    filters.push(`${vInputs}concat=n=${kept.length}:v=1:a=0[vjoined]`);
    if (opts.metadata.hasAudio) {
      const aInputs = kept.map((_, i) => `[a${i}]`).join('');
      filters.push(`${aInputs}concat=n=${kept.length}:v=0:a=1[aorig]`);
    }
  }

  // Smooth intro/outro fade on video when transition is fade/crossfade
  if (opts.transition !== 'none' && totalDuration > 1.2) {
    filters.push(
      `[vjoined]fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0.3, totalDuration - 0.3).toFixed(3)}:d=0.3[vfinal]`
    );
  } else {
    filters.push('[vjoined]null[vfinal]');
  }

  // 3. Audio Mixing (Original + Background Music + AI Voice-over)
  const audioStreamsToMix: string[] = [];

  if (opts.metadata.hasAudio && opts.originalAudioVolume > 0.01) {
    filters.push(
      `[aorig]volume=${opts.originalAudioVolume.toFixed(2)},atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[amix_orig]`
    );
    audioStreamsToMix.push('[amix_orig]');
  }

  if (musicInputIdx !== -1) {
    filters.push(
      `[${musicInputIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${opts.musicVolume.toFixed(2)},atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${Math.max(0.2, totalDuration - 0.5).toFixed(3)}:d=0.5,asetpts=PTS-STARTPTS[amix_music]`
    );
    audioStreamsToMix.push('[amix_music]');
  }

  if (voiceInputIdx !== -1) {
    filters.push(
      `[${voiceInputIdx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${opts.voiceoverVolume.toFixed(2)},apad=whole_dur=${totalDuration.toFixed(3)},atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[amix_voice]`
    );
    audioStreamsToMix.push('[amix_voice]');
  }

  let hasFinalAudio = false;
  if (audioStreamsToMix.length === 1) {
    filters.push(`${audioStreamsToMix[0]}anull[afinal]`);
    hasFinalAudio = true;
  } else if (audioStreamsToMix.length > 1) {
    filters.push(
      `${audioStreamsToMix.join('')}amix=inputs=${audioStreamsToMix.length}:duration=longest:dropout_transition=2:normalize=0[afinal]`
    );
    hasFinalAudio = true;
  }

  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vfinal]',
    ...(hasFinalAudio ? ['-map', '[afinal]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-threads',
    '0',
    '-movflags',
    '+faststart',
    '-t',
    totalDuration.toFixed(3),
    opts.outPath,
  ];

  await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });

  return {
    editedDurationSec: Math.round(totalDuration * 100) / 100,
    cutsApplied,
  };
}
