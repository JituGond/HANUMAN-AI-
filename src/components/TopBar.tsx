import React from 'react';
import { Upload, Download } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type WorkspaceSection = 'studio' | 'cuts' | 'script' | 'export' | 'architecture';

interface TopBarProps {
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
  hasProject: boolean;
  onTriggerUpload: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  onSelectSection,
  hasProject,
  onTriggerUpload,
}) => {
  const navItems: { id: WorkspaceSection; label: string }[] = [
    { id: 'studio', label: 'Studio' },
    { id: 'cuts', label: 'Cuts & Edits' },
    { id: 'script', label: 'Script & Voice' },
    { id: 'architecture', label: 'API & Stack' },
  ];

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-slate-800/90 bg-[#070B10]/90 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-8">
        {/* Zone 1: Single-line Brand Title */}
        <button
          type="button"
          onClick={() => onSelectSection('studio')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-md"
        >
          <img
            src="/icon.svg"
            alt=""
            className="h-7 w-7 rounded-md shrink-0"
            referrerPolicy="no-referrer"
          />
          <span className="font-display text-base lg:text-lg font-bold tracking-tight text-white">
            CutFlow Studio
          </span>
        </button>

        {/* Zone 2: Clean Single-Line Nav Links */}
        <nav className="hidden lg:flex items-center gap-6" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  active
                    ? 'border-emerald-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action (+ optional PWA install button when prompt available) */}
        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
          {hasProject ? (
            <button
              type="button"
              onClick={() => onSelectSection('export')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs lg:text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Download className="w-4 h-4" />
              <span>Export Video</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onTriggerUpload}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs lg:text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Video</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
