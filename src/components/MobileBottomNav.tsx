import React from 'react';
import { Clapperboard, Scissors, FileText, Download } from 'lucide-react';
import type { WorkspaceSection } from './TopBar';

interface MobileBottomNavProps {
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeSection,
  onSelectSection,
}) => {
  const tabs: { id: WorkspaceSection; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { id: 'studio', label: 'Studio', Icon: Clapperboard },
    { id: 'cuts', label: 'Cuts', Icon: Scissors },
    { id: 'script', label: 'Script', Icon: FileText },
    { id: 'export', label: 'Export', Icon: Download },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-slate-800 bg-[#070B10]/95 backdrop-blur-md pb-safe"
      aria-label="Mobile navigation"
    >
      <div className="grid grid-cols-4 h-16">
        {tabs.map(({ id, label, Icon }) => {
          const active = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectSection(id)}
              className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
                active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="mt-1 text-[11px] font-medium tracking-tight whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
