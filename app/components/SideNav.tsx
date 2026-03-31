import type { ReactNode } from "react";

export type SideNavTab = "map" | "directions" | "history" | "saved" | "settings";

interface SideNavProps {
  activeTab: SideNavTab;
  onTabChange: (tab: SideNavTab) => void;
  children: ReactNode;
}

const tabs: { id: SideNavTab; icon: string; label: string }[] = [
  { id: "map", icon: "map", label: "Map" },
  { id: "directions", icon: "directions", label: "Directions" },
  { id: "history", icon: "history", label: "Shadow History" },
  { id: "saved", icon: "bookmark", label: "Saved Routes" },
  { id: "settings", icon: "settings", label: "Settings" },
];

export default function SideNav({ activeTab, onTabChange, children }: SideNavProps) {
  return (
    <div className="flex flex-col h-full p-6">
      {/* Navigation tabs */}
      <nav className="space-y-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm tracking-tight w-full text-left transition-all duration-150 active:scale-95 ${
                active
                  ? "text-amber-900 font-bold border-r-4 border-amber-600 bg-amber-50/50"
                  : "text-slate-500 font-medium hover:bg-amber-50 hover:text-amber-700"
              }`}
            >
              <span
                className="material-symbols-outlined text-xl"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Phase-dependent content */}
      <div className="mt-6 flex-1 overflow-y-auto overflow-x-hidden md-scrollbar min-h-0">
        {children}
      </div>
    </div>
  );
}
