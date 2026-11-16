import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {
  analyzeVideoWithGemini,
  generateScriptWithGemini,
  generateVoiceoverBatch,
  splitTextForTTS,
  uploadVideoToGemini,
} from './server/gemini.js';
import {
  computeKeptRanges,
  detectAudioSilences,
  ensureMusicTrack,
  extractTimelineThumbnails,
  generateSampleVideo,
  probeVideo,
  renderFinalVideo,
} from './server/media.js';
import {
  MAX_VOICEOVER_SENTENCES,
  type CutSuggestion,
  type EditSettings,
  type MusicPreset,
  type ScriptLanguage,
  type ScriptLength,
  type ScriptStyle,
  type VideoMetadata,
  type VoiceId,
  type VoiceoverJobProgress,
} from './src/types/studio.js';
import { countSentences } from './src/utils/format.js';

interface ProjectRecord {
  id: string;
  originalName: string;
  mimeType: string;
  videoPath: string;
  thumbDir: string;
  thumbnails: string[];
  metadata: VideoMetadata;
  geminiFileUri?: string;
  geminiMimeType?: string;
  geminiUploadPromise?: Promise<{ fileUri: string; mimeType: string }>;
  voiceoverPath?: string;
  exportPath?: string;
  isSample?: boolean;
}

const MAX_VIDEO_SIZE_BYTES = 750 * 1024 * 1024; // 750 MB
const MAX_VIDEO_DURATION_SEC = 905; // 15 minutes (+5s tolerance)
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB chunks (safely below Cloud Run 32 MB limit)

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const ALLOWED_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

function resolveVideoFormat(originalName: string, reportedMime?: string): {
  ext: string;
  mimeType: string;
} | null {
  const ext = path.extname(originalName || '').toLowerCase();
  const mime = (reportedMime || '').toLowerCase().split(';')[0].trim();

  if (ALLOWED_EXTENSIONS.has(ext)) {
    if (ext === '.mov') return { ext: '.mov', mimeType: 'video/quicktime' };
    if (ext === '.webm') return { ext: '.webm', mimeType: 'video/webm' };
    return { ext: '.mp4', mimeType: 'video/mp4' };
  }

  if (ALLOWED_MIME_TYPES.has(mime)) {
    if (mime === 'video/quicktime') return { ext: '.mov', mimeType: 'video/quicktime' };
    if (mime === 'video/webm') return { ext: '.webm', mimeType: 'video/webm' };
    return { ext: '.mp4', mimeType: 'video/mp4' };
  }

  return null;
}

interface UploadSession {
  uploadId: string;
  originalName: string;
  mimeType: string;
  ext: string;
  expectedSize: number;
  receivedBytes: number;
  tempPath: string;
  createdAt: number;
}

const WORKSPACE_DIR = path.resolve(process.cwd(), 'tmp_studio');
const UPLOADS_DIR = path.join(WORKSPACE_DIR, 'uploads');
const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects');
const MUSIC_DIR = path.join(WORKSPACE_DIR, 'music');
const VOICEOVERS_DIR = path.join(WORKSPACE_DIR, 'voiceovers');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(VOICEOVERS_DIR, { recursive: true });

interface ServerVoiceoverJob extends VoiceoverJobProgress {
  filePath?: string;
  projectId?: string;
}

const projects = new Map<string, ProjectRecord>();
const uploadSessions = new Map<string, UploadSession>();
const voiceoverJobs = new Map<string, ServerVoiceoverJob>();

function saveProjectManifest(record: ProjectRecord) {
  const manifestPath = path.join(PROJECTS_DIR, record.id, 'project.json');
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
    isSample: record.isSample,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(serializable, null, 2));
}

function loadExistingProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return;
  for (const dirName of fs.readdirSync(PROJECTS_DIR)) {
    const manifestPath = path.join(PROJECTS_DIR, dirName, 'project.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ProjectRecord;
        if (parsed?.id && parsed?.videoPath && fs.existsSync(parsed.videoPath)) {
          projects.set(parsed.id, parsed);
        }
      } catch {
        // Ignore corrupted manifest
      }
    }
  }
}

loadExistingProjects();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const resolved = resolveVideoFormat(file.originalname, file.mimetype);
    const ext = resolved?.ext || path.extname(file.originalname || '').toLowerCase() || '.mp4';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_VIDEO_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const resolved = resolveVideoFormat(file.originalname, file.mimetype);
    if (!resolved) {
      cb(new Error('Unsupported video format. Please upload an MP4, MOV, or WebM video.'));
      return;
    }
    cb(null, true);
  },
});

function extractReadableErrorMessage(raw: string): string {
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { message?: string };
        message?: string;
      };
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
      // Fall back to raw string
    }
  }
  return raw;
}

function formatApiError(err: unknown): { status: number; message: string } {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, message: 'Video exceeds the 750 MB maximum file size limit.' };
    }
    return { status: 400, message: err.message || 'Invalid file upload request.' };
  }
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = extractReadableErrorMessage(rawMsg);
  if (
    msg.includes('Unsupported video format') ||
    msg.includes('10,000-byte') ||
    msg.includes('sentence limit') ||
    msg.includes('cannot be empty')
  ) {
    return { status: 400, message: msg };
  }
  if (rawMsg.includes('INVALID_ARGUMENT') || rawMsg.includes('"code":400')) {
    return { status: 400, message: msg || 'Invalid request parameters for AI generation.' };
  }
  if (
    rawMsg.includes('GEMINI_API_KEY is missing') ||
    rawMsg.includes('API_KEY_INVALID') ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('403')
  ) {
    return {
      status: 403,
      message:
        'AI service unavailable: Gemini API key is missing or invalid. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
    return {
      status: 429,
      message: 'AI service rate limit reached. Please wait a moment and try again.',
    };
  }
  if (
    rawMsg.includes('503') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('high demand') ||
    rawMsg.includes('ECONNREFUSED') ||
    rawMsg.includes('ENOTFOUND') ||
    rawMsg.includes('ETIMEDOUT') ||
    rawMsg.includes('fetch failed')
  ) {
    return {
      status: 503,
      message:
        'AI analysis service is temporarily unavailable or unreachable. Please check your connection and try again shortly.',
    };
  }
  return { status: 500, message: msg || 'Internal server error' };
}

async function ensureGeminiFile(project: ProjectRecord, forceRefresh = false) {
  if (!forceRefresh && project.geminiFileUri && project.geminiMimeType) {
    return { fileUri: project.geminiFileUri, mimeType: project.geminiMimeType };
  }
  if (forceRefresh) {
    project.geminiFileUri = undefined;
    project.geminiMimeType = undefined;
    project.geminiUploadPromise = undefined;
  }
  if (!project.geminiUploadPromise) {
    project.geminiUploadPromise = uploadVideoToGemini(project.videoPath, project.mimeType)
      .then((res) => {
        project.geminiFileUri = res.fileUri;
        project.geminiMimeType = res.mimeType;
        saveProjectManifest(project);
        return { fileUri: res.fileUri, mimeType: res.mimeType };
      })
      .catch((err) => {
        project.geminiUploadPromise = undefined;
        throw err;
      });
  }
  return project.geminiUploadPromise;
}

async function withFreshGeminiFile<T>(
  project: ProjectRecord,
  fn: (file: { fileUri: string; mimeType: string }) => Promise<T>
): Promise<T> {
  const file = await ensureGeminiFile(project);
  try {
    return await fn(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpiredFile =
      msg.includes('NOT_FOUND') ||
      msg.includes('404') ||
      (msg.includes('PERMISSION_DENIED') && msg.toLowerCase().includes('file'));
    if (isExpiredFile) {
      const refreshed = await ensureGeminiFile(project, true);
      return await fn(refreshed);
    }
    throw err;
  }
}

function streamRangeFile(
  req: express.Request,
  res: express.Response,
  filePath: string,
  contentType: string,
  downloadFilename?: string
) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found.' });
    return;
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const disposition =
    req.query?.download === '1' && downloadFilename
      ? { 'Content-Disposition': `attachment; filename="${downloadFilename}"` }
      : {};

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      ...disposition,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      ...disposition,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({ ok: true, geminiConfigured });
  });

  async function finalizeUploadedVideo(
    filePath: string,
    originalName: string,
    mimeType: string
  ) {
    const id = crypto.randomUUID();
    const projectDir = path.join(PROJECTS_DIR, id);
    const thumbDir = path.join(projectDir, 'thumbs');
    fs.mkdirSync(projectDir, { recursive: true });

    let metadata: VideoMetadata;
    try {
      metadata = await probeVideo(filePath);
    } catch (err) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmSync(projectDir, { recursive: true, force: true });
      throw err;
    }

    if (metadata.durationSec > MAX_VIDEO_DURATION_SEC) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmSync(projectDir, { recursive: true, force: true });
      throw Object.assign(
        new Error(
          `Video is ${(metadata.durationSec / 60).toFixed(1)} minutes long. Maximum supported length is 15 minutes.`
        ),
        { statusCode: 400 }
      );
    }

    // Move uploaded video inside its dedicated project directory for clean persistence
    const ext = path.extname(filePath) || '.mp4';
    const storedVideoPath = path.join(projectDir, `source${ext}`);
    fs.renameSync(filePath, storedVideoPath);

    const thumbnails = await extractTimelineThumbnails(
      storedVideoPath,
      thumbDir,
      metadata.durationSec,
      12
    );

    const record: ProjectRecord = {
      id,
      originalName: originalName || `uploaded-video${ext}`,
      mimeType,
      videoPath: storedVideoPath,
      thumbDir,
      thumbnails,
      metadata,
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
      geminiReady: false,
    };
  }

  // 1. Chunked Upload Init (supports large MP4, MOV, WebM files up to 750 MB behind Cloud Run proxies)
  app.post('/api/videos/upload/init', (req, res) => {
    try {
      const fileName = String(req.body?.fileName || '');
      const mimeType = String(req.body?.mimeType || '');
      const fileSize = Number(req.body?.fileSize || 0);

      if (!fileName) {
        res.status(400).json({ error: 'Missing file name.' });
        return;
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        res.status(400).json({ error: 'Selected video file is empty.' });
        return;
      }
      if (fileSize > MAX_VIDEO_SIZE_BYTES) {
        res.status(413).json({
          error: 'Video file exceeds the 750 MB limit. Please upload a smaller file.',
        });
        return;
      }

      const resolved = resolveVideoFormat(fileName, mimeType);
      if (!resolved) {
        res.status(400).json({
          error: 'Unsupported video format. Please upload an MP4, MOV, or WebM video.',
        });
        return;
      }

      const uploadId = crypto.randomUUID();
      const tempPath = path.join(UPLOADS_DIR, `${uploadId}${resolved.ext}`);
      fs.writeFileSync(tempPath, Buffer.alloc(0));

      uploadSessions.set(uploadId, {
        uploadId,
        originalName: fileName,
        mimeType: resolved.mimeType,
        ext: resolved.ext,
        expectedSize: fileSize,
        receivedBytes: 0,
        tempPath,
        createdAt: Date.now(),
      });

      res.json({
        uploadId,
        chunkSize: CHUNK_SIZE_BYTES,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Chunked Upload Binary Append
  app.post(
    '/api/videos/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    (req, res) => {
      try {
        const uploadId = String(req.headers['x-upload-id'] || '');
        const session = uploadSessions.get(uploadId);
        if (!session) {
          res.status(404).json({ error: 'Upload session expired or not found.' });
          return;
        }

        const chunkBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (chunkBuffer.length === 0) {
          res.status(400).json({ error: 'Empty upload chunk received.' });
          return;
        }

        if (session.receivedBytes + chunkBuffer.length > MAX_VIDEO_SIZE_BYTES) {
          if (fs.existsSync(session.tempPath)) fs.unlinkSync(session.tempPath);
          uploadSessions.delete(uploadId);
          res.status(413).json({ error: 'Video file exceeds the 750 MB limit.' });
          return;
        }

        fs.appendFileSync(session.tempPath, chunkBuffer);
        session.receivedBytes += chunkBuffer.length;

        res.json({
          uploadId,
          receivedBytes: session.receivedBytes,
        });
      } catch (err) {
        const { status, message } = formatApiError(err);
        res.status(status).json({ error: message });
      }
    }
  );

  // 3. Chunked Upload Complete & FFprobe/Thumbnail Finalization
  app.post('/api/videos/upload/complete', async (req, res) => {
    try {
      const uploadId = String(req.body?.uploadId || '');
      const session = uploadSessions.get(uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found.' });
        return;
      }
      uploadSessions.delete(uploadId);

      if (!fs.existsSync(session.tempPath)) {
        res.status(400).json({ error: 'Uploaded video file is missing on server.' });
        return;
      }

      const actualSize = fs.statSync(session.tempPath).size;
      if (actualSize !== session.expectedSize) {
        fs.unlinkSync(session.tempPath);
        res.status(400).json({
          error: `Upload incomplete (${actualSize} of ${session.expectedSize} bytes received). Please try again.`,
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
      const statusCode =
        typeof (err as { statusCode?: number })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : formatApiError(err).status;
      const message =
        err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });

  // Single-request multipart upload endpoint (for smaller files / direct API calls)
  app.post('/api/videos/upload', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No video file provided.' });
        return;
      }

      const resolved = resolveVideoFormat(req.file.originalname, req.file.mimetype);
      if (!resolved) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(400).json({
          error: 'Unsupported video format. Please upload an MP4, MOV, or WebM video.',
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
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      const statusCode =
        typeof (err as { statusCode?: number })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : formatApiError(err).status;
      const message =
        err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });

  // Generate a real sample multi-scene video for instant testing
  app.post('/api/videos/sample', async (_req, res) => {
    try {
      const id = crypto.randomUUID();
      const projectDir = path.join(PROJECTS_DIR, id);
      const thumbDir = path.join(projectDir, 'thumbs');
      const samplePath = path.join(projectDir, 'sample-studio-clip.mp4');
      fs.mkdirSync(projectDir, { recursive: true });

      await generateSampleVideo(samplePath);
      const metadata = await probeVideo(samplePath);
      const thumbnails = await extractTimelineThumbnails(
        samplePath,
        thumbDir,
        metadata.durationSec,
        12
      );

      const record: ProjectRecord = {
        id,
        originalName: 'creator-studio-sample.mp4',
        mimeType: 'video/mp4',
        videoPath: samplePath,
        thumbDir,
        thumbnails,
        metadata,
        isSample: true,
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
        isSample: true,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/videos/:id/stream', (req, res) => {
    const project = projects.get(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    streamRangeFile(req, res, project.videoPath, project.mimeType || 'video/mp4');
  });

  app.get('/api/videos/:id/thumbnails/:file', (req, res) => {
    const project = projects.get(req.params.id);
    if (!project) {
      res.status(404).end();
      return;
    }
    const safeName = path.basename(req.params.file);
    const thumbPath = path.join(project.thumbDir, safeName);
    if (!fs.existsSync(thumbPath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(thumbPath);
  });

  // Real Gemini AI Video Analysis
  app.post('/api/videos/:id/analyze', async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const silencesPromise = detectAudioSilences(
        project.videoPath,
        project.metadata.hasAudio
      );
      const analysis = await withFreshGeminiFile(project, async ({ fileUri, mimeType }) => {
        const silences = await silencesPromise;
        return analyzeVideoWithGemini(
          fileUri,
          mimeType,
          project.metadata.durationSec,
          silences
        );
      });
      res.json({ analysis, geminiReady: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Real Gemini AI Script Generator (7 styles x 3 lengths x Hindi/English)
  app.post('/api/videos/:id/script', async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const style = (req.body?.style || 'youtube') as ScriptStyle;
      const length = (req.body?.length || 'medium') as ScriptLength;
      const language = (req.body?.language || 'en') as ScriptLanguage;
      const cuts = (Array.isArray(req.body?.cuts) ? req.body.cuts : []) as CutSuggestion[];

      const kept = computeKeptRanges(project.metadata.durationSec, cuts);
      const editedDurationSec = kept.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);

      const script = await withFreshGeminiFile(project, ({ fileUri, mimeType }) =>
        generateScriptWithGemini(
          fileUri,
          mimeType,
          project.metadata.durationSec,
          editedDurationSec,
          style,
          length,
          language
        )
      );

      res.json({ script, geminiReady: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  function startVoiceoverJob(
    text: string,
    voiceId: VoiceId,
    language: ScriptLanguage,
    project?: ProjectRecord
  ): ServerVoiceoverJob {
    const sentenceCount = countSentences(text);
    if (sentenceCount === 0) {
      throw Object.assign(new Error('Script text cannot be empty.'), { statusCode: 400 });
    }
    if (sentenceCount > MAX_VOICEOVER_SENTENCES) {
      throw Object.assign(
        new Error(
          `Script contains ${sentenceCount.toLocaleString()} sentences, exceeding the ${MAX_VOICEOVER_SENTENCES.toLocaleString()}-sentence limit per voice-over.`
        ),
        { statusCode: 400 }
      );
    }

    const totalChunks = Math.max(1, splitTextForTTS(text).length);
    const jobId = crypto.randomUUID();
    const outFilePath = project
      ? path.join(PROJECTS_DIR, project.id, 'voiceover.wav')
      : path.join(VOICEOVERS_DIR, `${jobId}.wav`);

    const job: ServerVoiceoverJob = {
      jobId,
      status: 'running',
      totalSentences: sentenceCount,
      completedSentences: 0,
      totalChunks,
      completedChunks: 0,
      percent: 0,
      filePath: outFilePath,
      projectId: project?.id,
    };
    voiceoverJobs.set(jobId, job);

    generateVoiceoverBatch({
      scriptText: text,
      voiceId,
      language,
      outFilePath,
      onProgress: (p) => {
        job.completedChunks = p.completedChunks;
        job.totalChunks = p.totalChunks;
        job.completedSentences = p.completedSentences;
        job.percent = Math.min(99, Math.round((p.completedChunks / p.totalChunks) * 100));
      },
    })
      .then((result) => {
        if (project) {
          project.voiceoverPath = outFilePath;
          saveProjectManifest(project);
        }
        job.status = 'completed';
        job.completedChunks = result.chunkCount;
        job.totalChunks = result.chunkCount;
        job.completedSentences = result.sentenceCount;
        job.percent = 100;
        job.voiceover = {
          audioUrl: project
            ? `/api/videos/${project.id}/voiceover/audio?t=${Date.now()}`
            : `/api/voiceover/jobs/${jobId}/audio?t=${Date.now()}`,
          voiceId,
          language,
          durationHintSec: result.durationHintSec,
          sizeBytes: result.sizeBytes,
          sentenceCount: result.sentenceCount,
          chunkCount: result.chunkCount,
        };
      })
      .catch((err) => {
        const { message } = formatApiError(err);
        job.status = 'failed';
        job.error = message;
      });

    return job;
  }

  // Standalone Fast Batch Voice-over (up to 5,000 sentences in one click, multi-language)
  app.post('/api/voiceover/start', (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const voiceId = (req.body?.voiceId || 'Kore') as VoiceId;
      const language = (req.body?.language || 'en') as ScriptLanguage;
      const job = startVoiceoverJob(text, voiceId, language);
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        totalSentences: job.totalSentences,
        completedSentences: job.completedSentences,
        totalChunks: job.totalChunks,
        completedChunks: job.completedChunks,
        percent: job.percent,
      });
    } catch (err) {
      const statusCode =
        typeof (err as { statusCode?: number })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : formatApiError(err).status;
      const message =
        err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });

  app.get('/api/voiceover/jobs/:jobId', (req, res) => {
    const job = voiceoverJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Voice-over job not found.' });
      return;
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      totalSentences: job.totalSentences,
      completedSentences: job.completedSentences,
      totalChunks: job.totalChunks,
      completedChunks: job.completedChunks,
      percent: job.percent,
      voiceover: job.voiceover,
      error: job.error,
    });
  });

  app.get('/api/voiceover/jobs/:jobId/audio', (req, res) => {
    const job = voiceoverJobs.get(req.params.jobId);
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
      res.status(404).json({ error: 'Voiceover audio not found.' });
      return;
    }
    streamRangeFile(req, res, job.filePath, 'audio/wav', 'cutflow-voiceover.wav');
  });

  // Project-linked Async Batch Voice-over (up to 5,000 sentences, syncs with video export)
  app.post('/api/videos/:id/voiceover/start', (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const text = String(req.body?.text || '').trim();
      const voiceId = (req.body?.voiceId || 'Kore') as VoiceId;
      const language = (req.body?.language || 'en') as ScriptLanguage;
      const job = startVoiceoverJob(text, voiceId, language, project);
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        totalSentences: job.totalSentences,
        completedSentences: job.completedSentences,
        totalChunks: job.totalChunks,
        completedChunks: job.completedChunks,
        percent: job.percent,
      });
    } catch (err) {
      const statusCode =
        typeof (err as { statusCode?: number })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : formatApiError(err).status;
      const message =
        err instanceof Error ? err.message : formatApiError(err).message;
      res.status(statusCode).json({ error: message });
    }
  });

  app.get('/api/videos/:id/voiceover/jobs/:jobId', (req, res) => {
    const job = voiceoverJobs.get(req.params.jobId);
    if (!job || job.projectId !== req.params.id) {
      res.status(404).json({ error: 'Voice-over job not found.' });
      return;
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      totalSentences: job.totalSentences,
      completedSentences: job.completedSentences,
      totalChunks: job.totalChunks,
      completedChunks: job.completedChunks,
      percent: job.percent,
      voiceover: job.voiceover,
      error: job.error,
    });
  });

  // Synchronous Gemini AI Voice-over endpoint (also uses parallel streaming synthesis)
  app.post('/api/videos/:id/voiceover', async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const text = String(req.body?.text || '').trim();
      const voiceId = (req.body?.voiceId || 'Kore') as VoiceId;
      const language = (req.body?.language || 'en') as ScriptLanguage;

      if (!text) {
        res.status(400).json({ error: 'Script text cannot be empty.' });
        return;
      }

      const projectDir = path.join(WORKSPACE_DIR, 'projects', project.id);
      fs.mkdirSync(projectDir, { recursive: true });
      const voPath = path.join(projectDir, 'voiceover.wav');

      const result = await generateVoiceoverBatch({
        scriptText: text,
        voiceId,
        language,
        outFilePath: voPath,
      });

      project.voiceoverPath = voPath;
      saveProjectManifest(project);

      res.json({
        voiceover: {
          audioUrl: `/api/videos/${project.id}/voiceover/audio?t=${Date.now()}`,
          voiceId,
          language,
          durationHintSec: result.durationHintSec,
          sizeBytes: result.sizeBytes,
          sentenceCount: result.sentenceCount,
          chunkCount: result.chunkCount,
        },
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/videos/:id/voiceover/audio', (req, res) => {
    const project = projects.get(req.params.id);
    if (!project || !project.voiceoverPath || !fs.existsSync(project.voiceoverPath)) {
      res.status(404).json({ error: 'Voiceover audio not found.' });
      return;
    }
    const baseName = path.parse(project.originalName).name;
    streamRangeFile(req, res, project.voiceoverPath, 'audio/wav', `${baseName}-voiceover.wav`);
  });

  // Procedural background music tracks for live preview & FFmpeg export
  app.get('/api/music/:preset', async (req, res) => {
    try {
      const preset = req.params.preset as MusicPreset;
      const valid: MusicPreset[] = [
        'upbeat-tech',
        'chill-ambient',
        'cinematic-pulse',
        'gaming-synth',
      ];
      if (!valid.includes(preset)) {
        res.status(404).json({ error: 'Music preset not found.' });
        return;
      }
      const trackPath = path.join(MUSIC_DIR, `${preset}.wav`);
      await ensureMusicTrack(preset, trackPath, 16);
      streamRangeFile(req, res, trackPath, 'audio/wav');
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // High-quality MP4 Export via FFmpeg
  app.post('/api/videos/:id/export', async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const cuts = (Array.isArray(req.body?.cuts) ? req.body.cuts : []) as CutSuggestion[];
      const settings = (req.body?.settings || {}) as Partial<EditSettings>;
      const includeVoiceover = Boolean(req.body?.includeVoiceover);

      const musicPreset = (settings.music || 'none') as MusicPreset;
      let musicPath: string | null = null;
      if (musicPreset !== 'none') {
        const candidate = path.join(MUSIC_DIR, `${musicPreset}.wav`);
        musicPath = await ensureMusicTrack(musicPreset, candidate, 16);
      }

      const projectDir = path.join(WORKSPACE_DIR, 'projects', project.id);
      const outPath = path.join(projectDir, 'cutflow-export.mp4');

      const renderStats = await renderFinalVideo({
        inputPath: project.videoPath,
        outPath,
        metadata: project.metadata,
        cuts,
        transition: settings.transition || 'crossfade',
        zoom: settings.zoom || 'off',
        colorGrade: settings.colorGrade || 'original',
        musicPath,
        voiceoverPath: includeVoiceover ? project.voiceoverPath || null : null,
        originalAudioVolume:
          typeof settings.originalAudioVolume === 'number'
            ? settings.originalAudioVolume
            : 1,
        musicVolume:
          typeof settings.musicVolume === 'number' ? settings.musicVolume : 0.28,
        voiceoverVolume:
          typeof settings.voiceoverVolume === 'number' ? settings.voiceoverVolume : 1,
        quality: settings.exportQuality === '1080p' ? '1080p' : '720p',
      });

      project.exportPath = outPath;
      saveProjectManifest(project);
      const stat = fs.statSync(outPath);
      const baseName = path.parse(project.originalName).name;

      res.json({
        exportResult: {
          downloadUrl: `/api/videos/${project.id}/export/download?t=${Date.now()}`,
          filename: `${baseName}-cutflow-edited.mp4`,
          sizeBytes: stat.size,
          editedDurationSec: renderStats.editedDurationSec,
          cutsApplied: renderStats.cutsApplied,
        },
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/videos/:id/export/download', (req, res) => {
    const project = projects.get(req.params.id);
    if (!project || !project.exportPath || !fs.existsSync(project.exportPath)) {
      res.status(404).json({ error: 'Exported video not found.' });
      return;
    }
    const baseName = path.parse(project.originalName).name;
    res.download(project.exportPath, `${baseName}-cutflow-edited.mp4`);
  });

  // Ensure all /api/* errors return structured JSON (including Multer & body parser errors)
  app.use(
    '/api',
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CutFlow Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
