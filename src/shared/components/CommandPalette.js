"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";
import { navItems, debugItems, systemItems } from "@/shared/components/Sidebar";

const RECENT_ITEMS_KEY = "9router-recent-pages";

function getRecentPages() {
  try {
    const stored = localStorage.getItem(RECENT_ITEMS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentPage(href) {
  try {
    const recent = getRecentPages().filter((item) => item !== href);
    recent.unshift(href);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(recent.slice(0, 5)));
  } catch {
    // Storage full or unavailable
  }
}

const ALL_ITEMS = [
  ...navItems.map((item) => ({ ...item, category: "Main" })),
  ...debugItems.map((item) => ({ ...item, category: "Debug" })),
  ...systemItems.map((item) => ({ ...item, category: "System" })),
];

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentPages, setRecentPages] = useState([]);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setRecentPages(getRecentPages());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const filteredItems = ALL_ITEMS.filter((item) => {
    const searchStr = `${item.label} ${item.category}`.toLowerCase();
    return searchStr.includes(query.toLowerCase());
  });

  const handleSelect = useCallback(
    (href) => {
      saveRecentPage(href);
      setIsOpen(false);
      setQuery("");
      router.push(href);
    },
    [router]
  );

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === "Enter" && filteredItems[selectedIndex]) {
      e.preventDefault();
      handleSelect(filteredItems[selectedIndex].href);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      <div className="relative w-full max-w-2xl mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="material-symbols-outlined text-[20px] text-text-muted">search</span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-text-muted"
          />
          <kbd className="px-2 py-0.5 rounded bg-white/10 text-[11px] text-text-muted font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
          {!query && recentPages.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">Recent</p>
              {recentPages
                .filter((href) => href !== pathname)
                .slice(0, 3)
                .map((href) => {
                  const item = ALL_ITEMS.find((i) => i.href === href);
                  if (!item) return null;
                  return (
                    <button
                      key={href}
                      onClick={() => handleSelect(href)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      <span className="material-symbols-outlined text-[18px] text-text-muted">{item.icon}</span>
                      <span className="text-sm text-white">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          )}

          {filteredItems.length > 0 ? (
            <div>
              {!query && <p className="px-2 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">Navigation</p>}
              {filteredItems.map((item, index) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={item.href}
                    onClick={() => handleSelect(item.href)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-left",
                      isSelected ? "bg-primary/20" : "hover:bg-white/5",
                      isActive && !isSelected ? "bg-primary/10" : ""
                    )}
                  >
                    <span
                      className={cn(
                        "material-symbols-outlined text-[18px]",
                        isActive ? "text-primary" : "text-text-muted"
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className={cn("text-sm flex-1", isActive ? "text-primary font-medium" : "text-white")}>
                      {item.label}
                    </span>
                    {isActive && <span className="text-[11px] text-primary">Current</span>}
                    <span className="text-[11px] text-text-muted">{item.category}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-text-muted">No results found for "{query}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 bg-white/5">
          <div className="flex items-center gap-3 text-[11px] text-text-muted">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">↵</kbd> Select
            </span>
          </div>
          <span className="text-[11px] text-text-muted">{filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}