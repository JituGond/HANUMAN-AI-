import React, { useRef, useState } from 'react';
import { TopBar, type WorkspaceSection } from './components/TopBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { OfflineIndicator } from './components/PWAInstallButton';
import { UploadStage } from './components/UploadStage';
import { VideoPreviewPlayer } from './components/VideoPreviewPlayer';
import { AnalysisCutsPanel } from './components/AnalysisCutsPanel';
import { EditEffectsPanel } from './components/EditEffectsPanel';
import { ScriptVoicePanel } from './components/ScriptVoicePanel';
import { ExportSheet } from './components/ExportSheet';
import { ApiArchitectureView } from './components/ApiArchitectureView';
import type {
  CutCategory,
  CutSuggestion,
  EditSettings,
  ExportResult,
  GeneratedScript,
  ScriptLanguage,
  ScriptLength,
  ScriptStyle,
  VideoAnalysis,
  VideoProject,
  VoiceId,
  VoiceoverJobProgress,
  VoiceoverResult,
} from './types/studio';
import { computeKeptSummary, formatTime } from './utils/format';

const DEFAULT_EDIT_SETTINGS: EditSettings = {
  transition: 'crossfade',
  zoom: 'off',
  colorGrade: 'original',
  music: 'none',
  originalAudioVolume: 1,
  musicVolume: 0.28,
  voiceoverVolume: 1,
  exportQuality: '720p',
};

export default function App() {
  const hiddenFileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeSection, setActiveSection] = useState<WorkspaceSection>('studio');
  const [inspectorTab, setInspectorTab] = useState<'cuts' | 'effects' | 'script' | 'export'>('cuts');

  const [project, setProject] = useState<VideoProject | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStageLabel, setUploadStageLabel] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [seekTrigger, setSeekTrigger] = useState<{ timeSec: number; nonce: number } | null>(null);
  const [auditionCut, setAuditionCut] = useState<{
    startSec: number;
    endSec: number;
    reason?: string;
    nonce: number;
  } | null>(null);

  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [cuts, setCuts] = useState<CutSuggestion[]>([]);
  const [cutHistory, setCutHistory] = useState<CutSuggestion[][]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [editSettings, setEditSettings] = useState<EditSettings>(DEFAULT_EDIT_SETTINGS);

  const [scriptStyle, setScriptStyle] = useState<ScriptStyle>('youtube');
  const [scriptLength, setScriptLength] = useState<ScriptLength>('medium');
  const [scriptLanguage, setScriptLanguage] = useState<ScriptLanguage>('en');
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(null);
  const [editedScriptText, setEditedScriptText] = useState('');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('Kore');
  const [voiceover, setVoiceover] = useState<VoiceoverResult | null>(null);
  const [voiceoverProgress, setVoiceoverProgress] = useState<VoiceoverJobProgress | null>(null);
  const [includeVoiceover, setIncludeVoiceover] = useState(true);
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const resetWorkspaceForNewVideo = (nextProject: VideoProject) => {
    setProject(nextProject);
    setCurrentTime(0);
    setSeekTrigger(null);
    setAuditionCut(null);
    setAnalysis(null);
    setCuts([]);
    setCutHistory([]);
    setAnalyzeError(null);
    setEditSettings(DEFAULT_EDIT_SETTINGS);
    setGeneratedScript(null);
    setEditedScriptText('');
    setScriptError(null);
    setVoiceover(null);
    setVoiceoverProgress(null);
    setVoiceoverError(null);
    setExportResult(null);
    setExportError(null);
    setActiveSection('studio');
    setInspectorTab('cuts');
  };

  const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm'];
  const ALLOWED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
  const MAX_VIDEO_SIZE_BYTES = 750 * 1024 * 1024;

  const parseJsonSafely = async (response: Response) => {
    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        response.ok
          ? 'Server returned an invalid JSON response.'
          : `Server error (HTTP ${response.status}). Please try again.`
      );
    }
  };

  const uploadBinaryChunk = (
    uploadId: string,
    chunk: Blob,
    onProgress: (loadedBytes: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/videos/upload/chunk');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Upload-Id', uploadId);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onProgress(evt.loaded);
        }
      };

      xhr.onload = () => {
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(parsed.error || `Chunk upload failed (HTTP ${xhr.status}).`));
          }
        } catch {
          reject(new Error(`Server returned HTTP ${xhr.status} during video chunk upload.`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error while uploading video chunk. Please check your connection.'));
      };

      xhr.send(chunk);
    });
  };

  const handleFileUpload = async (file: File) => {
    setUploadError(null);

    const lowerName = (file.name || '').toLowerCase();
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const cleanMime = (file.type || '').toLowerCase().split(';')[0].trim();
    const hasValidMime = ALLOWED_MIME_TYPES.includes(cleanMime);

    if (!hasValidExt && !hasValidMime) {
      setUploadError('Unsupported video format. Please select an MP4, MOV, or WebM video.');
      return;
    }

    if (file.size <= 0) {
      setUploadError('The selected video file is empty.');
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      setUploadError('Video exceeds the 750 MB maximum file size limit.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(1);
    setUploadStageLabel('Initializing video upload...');

    try {
      const initRes = await fetch('/api/videos/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name || 'video.mp4',
          mimeType: cleanMime || 'video/mp4',
          fileSize: file.size,
        }),
      });
      const initData = await parseJsonSafely(initRes);
      if (!initRes.ok) {
        throw new Error(initData.error || 'Could not start video upload.');
      }

      const uploadId = String(initData.uploadId);
      const chunkSize = Number(initData.chunkSize) || 8 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

      let uploadedBytes = 0;
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunk = file.slice(start, end);

        setUploadStageLabel(
          totalChunks > 1
            ? `Uploading video (part ${i + 1} of ${totalChunks})...`
            : 'Uploading video to studio...'
        );

        await uploadBinaryChunk(uploadId, chunk, (chunkLoaded) => {
          const totalLoaded = uploadedBytes + chunkLoaded;
          const pct = Math.min(92, Math.max(2, Math.round((totalLoaded / file.size) * 92)));
          setUploadProgress(pct);
        });

        uploadedBytes = end;
        setUploadProgress(Math.min(92, Math.round((uploadedBytes / file.size) * 92)));
      }

      setUploadProgress(94);
      setUploadStageLabel('Validating duration & extracting timeline frames...');

      const completeRes = await fetch('/api/videos/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      const completeData = await parseJsonSafely(completeRes);
      if (!completeRes.ok) {
        throw new Error(completeData.error || 'Failed to finalize uploaded video.');
      }

      setUploadProgress(100);
      resetWorkspaceForNewVideo(completeData as VideoProject);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload video.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleLoadSample = async () => {
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(45);
    setUploadStageLabel('Generating multi-scene sample clip...');
    try {
      const res = await fetch('/api/videos/sample', { method: 'POST' });
      const data = await parseJsonSafely(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate sample video.');
      }
      setUploadProgress(100);
      resetWorkspaceForNewVideo(data as VideoProject);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to load sample clip.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectSection = (section: WorkspaceSection) => {
    setActiveSection(section);
    if (section === 'cuts') setInspectorTab('cuts');
    if (section === 'script') setInspectorTab('script');
    if (section === 'export') setInspectorTab('export');
  };

  const handleRunAnalysis = async () => {
    if (!project) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/videos/${project.id}/analyze`, {
        method: 'POST',
      });
      const data = await parseJsonSafely(res);
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      const nextAnalysis = data.analysis as VideoAnalysis;
      if (cuts.length > 0) {
        setCutHistory((hist) => [...hist.slice(-19), cuts]);
      }
      setAuditionCut(null);
      setAnalysis(nextAnalysis);
      setCuts(nextAnalysis.suggestedCuts || []);
      setExportResult(null);
      setProject((prev) => (prev ? { ...prev, geminiReady: true } : prev));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!project) return;
    setIsGeneratingScript(true);
    setScriptError(null);
    try {
      const res = await fetch(`/api/videos/${project.id}/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: scriptStyle,
          length: scriptLength,
          language: scriptLanguage,
          cuts,
        }),
      });
      const data = await parseJsonSafely(res);
      if (!res.ok) throw new Error(data.error || 'Script generation failed.');
      const script = data.script as GeneratedScript;
      setGeneratedScript(script);
      setEditedScriptText(script.fullText);
      setProject((prev) => (prev ? { ...prev, geminiReady: true } : prev));
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Script generation failed.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!editedScriptText.trim()) return;
    setIsGeneratingVoiceover(true);
    setVoiceoverError(null);
    setVoiceoverProgress(null);

    try {
      const startEndpoint = project
        ? `/api/videos/${project.id}/voiceover/start`
        : '/api/voiceover/start';

      const startRes = await fetch(startEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editedScriptText,
          voiceId: selectedVoice,
          language: scriptLanguage,
        }),
      });
      const startData = await parseJsonSafely(startRes);
      if (!startRes.ok) {
        throw new Error(startData.error || 'Voiceover generation failed.');
      }

      const initialJob = startData as VoiceoverJobProgress;
      setVoiceoverProgress(initialJob);

      const statusEndpoint = project
        ? `/api/videos/${project.id}/voiceover/jobs/${initialJob.jobId}`
        : `/api/voiceover/jobs/${initialJob.jobId}`;

      while (true) {
        await new Promise((r) => setTimeout(r, 850));
        const pollRes = await fetch(statusEndpoint);
        const pollData = (await parseJsonSafely(pollRes)) as VoiceoverJobProgress & {
          error?: string;
        };
        if (!pollRes.ok) {
          throw new Error(pollData.error || 'Failed to check voiceover synthesis progress.');
        }

        setVoiceoverProgress(pollData);

        if (pollData.status === 'completed' && pollData.voiceover) {
          setVoiceover(pollData.voiceover);
          setIncludeVoiceover(true);
          break;
        }
        if (pollData.status === 'failed') {
          throw new Error(pollData.error || 'Voiceover generation failed.');
        }
      }
    } catch (err) {
      setVoiceoverError(err instanceof Error ? err.message : 'Voiceover generation failed.');
    } finally {
      setIsGeneratingVoiceover(false);
    }
  };

  const handleStartExport = async () => {
    if (!project) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/videos/${project.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuts,
          settings: editSettings,
          includeVoiceover: Boolean(voiceover && includeVoiceover),
        }),
      });
      const data = await parseJsonSafely(res);
      if (!res.ok) throw new Error(data.error || 'Export failed.');
      setExportResult(data.exportResult as ExportResult);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Video export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSeekTo = (timeSec: number) => {
    setAuditionCut(null);
    setSeekTrigger({ timeSec, nonce: Date.now() });
  };

  const handlePreviewCut = (cut: CutSuggestion) => {
    setAuditionCut({
      startSec: cut.startSec,
      endSec: cut.endSec,
      reason: cut.reason,
      nonce: Date.now(),
    });
  };

  const handleSetCutApproved = (id: string, approved: boolean) => {
    const target = cuts.find((c) => c.id === id);
    if (!target || target.approved === approved) return;
    setCutHistory((hist) => [...hist.slice(-19), cuts]);
    setCuts(cuts.map((c) => (c.id === id ? { ...c, approved } : c)));
    setExportResult(null);
  };

  const handleRemoveCut = (id: string) => {
    if (!cuts.some((c) => c.id === id)) return;
    setCutHistory((hist) => [...hist.slice(-19), cuts]);
    setCuts(cuts.filter((c) => c.id !== id));
    setExportResult(null);
  };

  const handleSetAllCuts = (approved: boolean) => {
    if (!cuts.some((c) => c.approved !== approved)) return;
    setCutHistory((hist) => [...hist.slice(-19), cuts]);
    setCuts(cuts.map((c) => ({ ...c, approved })));
    setExportResult(null);
  };

  const handleUndoCut = () => {
    if (cutHistory.length === 0) return;
    const previousCuts = cutHistory[cutHistory.length - 1];
    setCutHistory(cutHistory.slice(0, -1));
    setCuts(previousCuts);
    setAuditionCut(null);
    setExportResult(null);
  };

  const handleAddManualCut = (
    startSec: number,
    endSec: number,
    category: CutCategory,
    reason: string
  ) => {
    setCutHistory((hist) => [...hist.slice(-19), cuts]);
    setCuts(
      [
        ...cuts,
        {
          id: `manual-${Date.now()}`,
          startSec,
          endSec,
          category,
          reason,
          approved: true,
        },
      ].sort((a, b) => a.startSec - b.startSec)
    );
    setExportResult(null);
  };

  const keptSummary = project
    ? computeKeptSummary(project.metadata.durationSec, cuts)
    : null;

  return (
    <div className="min-h-screen bg-[#070B10] text-slate-100 pb-24 lg:pb-10">
      <input
        ref={hiddenFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileUpload(f);
          e.target.value = '';
        }}
      />

      <TopBar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        hasProject={Boolean(project)}
        onTriggerUpload={() => hiddenFileInputRef.current?.click()}
      />

      {activeSection === 'architecture' ? (
        <ApiArchitectureView />
      ) : !project && activeSection === 'script' ? (
        <main className="mx-auto max-w-3xl px-4 py-6 lg:py-8">
          <ScriptVoicePanel
            hasProject={false}
            onTriggerUploadVideo={() => hiddenFileInputRef.current?.click()}
            script={generatedScript}
            editedScriptText={editedScriptText}
            onChangeEditedScriptText={setEditedScriptText}
            style={scriptStyle}
            length={scriptLength}
            language={scriptLanguage}
            onChangeStyle={setScriptStyle}
            onChangeLength={setScriptLength}
            onChangeLanguage={setScriptLanguage}
            isGeneratingScript={isGeneratingScript}
            scriptError={scriptError}
            onGenerateScript={handleGenerateScript}
            selectedVoice={selectedVoice}
            onChangeVoice={setSelectedVoice}
            voiceover={voiceover}
            voiceoverProgress={voiceoverProgress}
            isGeneratingVoiceover={isGeneratingVoiceover}
            voiceoverError={voiceoverError}
            onGenerateVoiceover={handleGenerateVoiceover}
            onSeekTo={handleSeekTo}
          />
        </main>
      ) : !project ? (
        <UploadStage
          onFileSelected={handleFileUpload}
          onLoadSample={handleLoadSample}
          onOpenVoiceStudio={() => handleSelectSection('script')}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          uploadStageLabel={uploadStageLabel}
          error={uploadError}
        />
      ) : (
        <main className="mx-auto max-w-[1440px] px-4 lg:px-8 pt-5 lg:pt-7">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Video Preview Player (Always visible on Desktop, or on Studio tab on Mobile) */}
            <div
              className={`lg:col-span-7 lg:sticky lg:top-20 space-y-4 ${
                activeSection === 'studio' ? 'block' : 'hidden lg:block'
              }`}
            >
              <VideoPreviewPlayer
                project={project}
                cuts={cuts}
                highlights={analysis?.highlights || []}
                settings={editSettings}
                voiceover={includeVoiceover ? voiceover : null}
                currentTime={currentTime}
                onTimeChange={setCurrentTime}
                seekTrigger={seekTrigger}
                auditionCut={auditionCut}
                onClearAudition={() => setAuditionCut(null)}
                onChangeVideo={() => {
                  setProject(null);
                  setAuditionCut(null);
                  setUploadError(null);
                  setActiveSection('studio');
                }}
              />

              {/* Compact Studio Metrics Strip */}
              {keptSummary && (
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-[#0C1219] px-4 py-3">
                  <div>
                    <p className="text-[11px] text-slate-400">Edited Runtime</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {formatTime(keptSummary.keptSec)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Approved Cuts</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
                      {cuts.filter((c) => c.approved).length} ({keptSummary.cutSec.toFixed(1)}s)
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Script &amp; Voice</p>
                    <p className="mt-0.5 text-sm font-semibold text-sky-400 truncate">
                      {voiceover
                        ? `${voiceover.voiceId} Ready`
                        : generatedScript
                          ? 'Script Ready'
                          : 'Not Generated'}
                    </p>
                  </div>
                </div>
              )}

              {/* Mobile Studio Quick-Jump Cards */}
              <div className="grid grid-cols-2 gap-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => handleSelectSection('cuts')}
                  className="rounded-xl border border-slate-800 bg-[#0C1219] p-4 text-left hover:border-emerald-500/40 transition-colors min-h-[44px]"
                >
                  <p className="text-sm font-semibold text-white">AI Cuts &amp; Effects</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Analyze scenes, approve cuts, music
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSection('script')}
                  className="rounded-xl border border-slate-800 bg-[#0C1219] p-4 text-left hover:border-sky-500/40 transition-colors min-h-[44px]"
                >
                  <p className="text-sm font-semibold text-white">Script &amp; Voice</p>
                  <p className="mt-1 text-xs text-slate-400">
                    7 styles · Hindi/English TTS
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSection('architecture')}
                  className="col-span-2 rounded-xl border border-slate-800 bg-[#0C1219] px-4 py-3 text-left text-xs text-slate-400 hover:text-slate-200"
                >
                  View External AI APIs &amp; Android Architecture →
                </button>
              </div>
            </div>

            {/* Right Column: Tabbed Studio Inspector */}
            <div
              className={`lg:col-span-5 space-y-5 ${
                activeSection === 'studio' ? 'hidden lg:block' : 'block'
              }`}
            >
              {/* Inspector Tabs (Desktop + Mobile Cuts/Effects sub-switcher) */}
              <div className="grid grid-cols-4 gap-1 rounded-xl border border-slate-800 bg-[#0C1219] p-1">
                {(
                  [
                    { id: 'cuts', label: 'Cuts & AI' },
                    { id: 'effects', label: 'Effects' },
                    { id: 'script', label: 'Script' },
                    { id: 'export', label: 'Export' },
                  ] as const
                ).map((tab) => {
                  const active = inspectorTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setInspectorTab(tab.id);
                        if (tab.id === 'export') setActiveSection('export');
                        else if (tab.id === 'script') setActiveSection('script');
                        else setActiveSection('cuts');
                      }}
                      className={`py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap min-h-[38px] ${
                        active
                          ? 'bg-emerald-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {inspectorTab === 'cuts' && (
                <AnalysisCutsPanel
                  durationSec={project.metadata.durationSec}
                  currentTime={currentTime}
                  analysis={analysis}
                  cuts={cuts}
                  canUndo={cutHistory.length > 0}
                  isAnalyzing={isAnalyzing}
                  analyzeError={analyzeError}
                  onRunAnalysis={handleRunAnalysis}
                  onSetCutApproved={handleSetCutApproved}
                  onRemoveCut={handleRemoveCut}
                  onSetAllCuts={handleSetAllCuts}
                  onUndoCut={handleUndoCut}
                  onAddManualCut={handleAddManualCut}
                  onPreviewCut={handlePreviewCut}
                  onSeekTo={handleSeekTo}
                />
              )}

              {inspectorTab === 'effects' && (
                <EditEffectsPanel
                  settings={editSettings}
                  recommendations={analysis?.recommendations || null}
                  hasVoiceover={Boolean(voiceover)}
                  onChange={(next) => {
                    setEditSettings(next);
                    setExportResult(null);
                  }}
                />
              )}

              {inspectorTab === 'script' && (
                <ScriptVoicePanel
                  hasProject={true}
                  script={generatedScript}
                  editedScriptText={editedScriptText}
                  onChangeEditedScriptText={setEditedScriptText}
                  style={scriptStyle}
                  length={scriptLength}
                  language={scriptLanguage}
                  onChangeStyle={setScriptStyle}
                  onChangeLength={setScriptLength}
                  onChangeLanguage={setScriptLanguage}
                  isGeneratingScript={isGeneratingScript}
                  scriptError={scriptError}
                  onGenerateScript={handleGenerateScript}
                  selectedVoice={selectedVoice}
                  onChangeVoice={setSelectedVoice}
                  voiceover={voiceover}
                  voiceoverProgress={voiceoverProgress}
                  isGeneratingVoiceover={isGeneratingVoiceover}
                  voiceoverError={voiceoverError}
                  onGenerateVoiceover={handleGenerateVoiceover}
                  onSeekTo={handleSeekTo}
                />
              )}

              {inspectorTab === 'export' && (
                <ExportSheet
                  project={project}
                  cuts={cuts}
                  settings={editSettings}
                  voiceover={voiceover}
                  includeVoiceover={includeVoiceover}
                  onToggleIncludeVoiceover={setIncludeVoiceover}
                  onChangeQuality={(q) =>
                    setEditSettings((prev) => ({ ...prev, exportQuality: q }))
                  }
                  isExporting={isExporting}
                  exportError={exportError}
                  exportResult={exportResult}
                  onStartExport={handleStartExport}
                />
              )}
            </div>
          </div>
        </main>
      )}

      <OfflineIndicator />
      <MobileBottomNav
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
      />
    </div>
  );
}
