import React from 'react';
import { Server, Cpu, Smartphone, Mic, Scissors } from 'lucide-react';

export const ApiArchitectureView: React.FC = () => {
  const stack = [
    {
      title: '1. Long-Form Video Understanding (Up to 15 Min)',
      api: 'Google Gemini Files API + gemini-4-hydrogen',
      role: 'Uploads MP4/MOV/WebM videos up to 750 MB server-side via ai.files.upload, polls until ACTIVE, and performs multimodal visual + audio analysis with structured JSON timestamps for highlights, dead air, and mistakes.',
      tier: 'Server-side GEMINI_API_KEY (Free / Pay-as-you-go Gemini API)',
      Icon: Cpu,
    },
    {
      title: '2. Multi-Style Hindi & English Script Generation',
      api: 'Gemini 4 Hydrogen (@google/genai)',
      role: 'Reads the uploaded video URI directly to write time-coded scripts across 7 creator styles (Professional, Funny, Entertainment, Gaming, Storytelling, Informative, YouTube) in Short, Medium, and Long formats in English or Devanagari Hindi.',
      tier: 'Included in Gemini API',
      Icon: Server,
    },
    {
      title: '3. Natural Male & Female AI Voice-over',
      api: 'Gemini 3.8 Flash Lite TTS (gemini-3.8-flash-lite-tts)',
      role: 'Synthesizes natural 24kHz WAV speech with 5 distinct Male & Female voice personas (Kore, Zephyr, Charon, Fenrir, Puck) and automatic long-script chunk concatenation.',
      tier: 'Included in Gemini API',
      Icon: Mic,
    },
    {
      title: '4. Real Video Cutting, Transitions, Zoom & MP4 Export',
      api: 'Server-side FFmpeg + FFprobe Pipeline',
      role: 'Probes video streams, extracts timeline frame thumbnails, trims approved cuts, applies xfade transitions, color grading (eq), dynamic zoom, synthesizes background music tracks, mixes 3 audio stems, and exports H.264/AAC MP4.',
      tier: 'Self-hosted Node.js + FFmpeg (Zero per-minute SaaS fees)',
      Icon: Scissors,
    },
    {
      title: '5. Android App Installation & Play Store Packaging',
      api: 'Installable Android PWA + Trusted Web Activity (TWA)',
      role: 'Configured with Web App Manifest, Workbox Service Worker, and standalone mobile touch layout. Install directly onto Android from Chrome ("Install Android App") or wrap into a Play Store AAB/APK using Bubblewrap CLI.',
      tier: 'Zero-cost PWA / Google Play Developer account for Store publishing',
      Icon: Smartphone,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-white">
          External APIs, Models &amp; Android Stack
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          CutFlow Studio runs real multimodal AI analysis, speech synthesis, and FFmpeg video rendering—never simulated mockups. Below is the exact integration architecture powering each capability.
        </p>
      </div>

      <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-[#0C1219]">
        {stack.map(({ title, api, role, tier, Icon }) => (
          <div key={title} className="p-5 sm:p-6 flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Icon className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-white">{title}</h3>
              <p className="text-xs font-mono text-sky-400">{api}</p>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{role}</p>
              <p className="text-xs text-emerald-400 font-medium pt-0.5">{tier}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
