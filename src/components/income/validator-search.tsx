"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Server, X } from "lucide-react";

interface ValidatorListItem {
  validatorId: number;
  name: string;
  authAddress: string;
  stakeMon: number;
  commissionPct: number;
  lastEpoch: number;
}

interface ValidatorSearchProps {
  validators: ValidatorListItem[];
  selected: ValidatorListItem | null;
  onSelect: (v: ValidatorListItem) => void;
}

function formatStake(mon: number): string {
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(2)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(1)}K`;
  return mon.toFixed(0);
}

// Solid surfaces — fully opaque so aurora/particles never bleed through.
const PANEL_BG = "#161513";
const PANEL_BG_HOVER = "#1f1d1a";
const SCRIM_BG = "rgba(15, 14, 12, 0.86)";

export function ValidatorSearch({
  validators,
  selected,
  onSelect,
}: ValidatorSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Portal needs to wait for client-side mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Recompute panel anchor whenever it opens, the window resizes/scrolls,
  // or validators load (which changes trigger height).
  useEffect(() => {
    if (!open) return;
    function update() {
      if (triggerRef.current) {
        setAnchorRect(triggerRef.current.getBoundingClientRect());
      }
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Close on outside click — match against trigger AND portal panel.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus input on open, reset on close.
  useEffect(() => {
    if (open) {
      // Defer until panel is in the DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  // Lock page scroll while open so the panel stays visually anchored
  // and the page underneath doesn't compete for attention.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return validators;
    return validators.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.authAddress.toLowerCase().includes(q) ||
        v.validatorId.toString().includes(q)
    );
  }, [validators, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) {
        onSelect(pick);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Trigger button — stays in the page flow, takes its grid slot.
  const trigger = (
    <button
      ref={triggerRef}
      onClick={() => setOpen((o) => !o)}
      className="group w-full flex items-center gap-3 border border-cream-12 rounded-xl px-5 py-4 text-left hover:border-phase-green/40 transition-all shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      style={{ background: PANEL_BG }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-cream-12 group-hover:border-phase-green/40 transition-colors"
        style={{ background: PANEL_BG_HOVER }}
      >
        <Search className="w-4 h-4 text-cream-60 group-hover:text-phase-green transition-colors" />
      </div>
      {selected ? (
        <div className="flex-1 flex items-center justify-between min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-cream font-body text-sm font-medium truncate">
                {selected.name}
              </span>
              <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
                #{selected.validatorId}
              </span>
            </div>
            <div className="text-cream-40 text-xs font-mono mt-0.5 truncate">
              {selected.authAddress.slice(0, 10)}…{selected.authAddress.slice(-8)}
            </div>
          </div>
          <div className="flex items-center gap-3 text-cream-60 text-xs font-body shrink-0 ml-3">
            <span className="font-medium text-cream">{formatStake(selected.stakeMon)} MON</span>
            <span className="text-cream-40">·</span>
            <span>{selected.commissionPct}% fee</span>
          </div>
        </div>
      ) : (
        <span className="flex-1 text-cream-40 text-sm font-body">
          Search any validator by name, address, or ID…
        </span>
      )}
      <ChevronDown
        className={`w-4 h-4 text-cream-40 shrink-0 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );

  // Compute panel position from the anchor rect. Falls back to the trigger's
  // last known box if anchorRect isn't ready yet.
  const panelStyle: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: anchorRect.bottom + 8,
        left: anchorRect.left,
        width: anchorRect.width,
        background: PANEL_BG,
        maxHeight: `min(560px, calc(100vh - ${anchorRect.bottom + 24}px))`,
        zIndex: 1001,
      }
    : { display: "none" };

  // Portal content — full-viewport scrim + the panel itself.
  const portal = open && mounted ? (
    createPortal(
      <>
        {/* Scrim — solid enough to dim the page and stop visual bleed-through */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            background: SCRIM_BG,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 1000,
          }}
          onClick={() => setOpen(false)}
        />
        {/* Floating panel anchored to the trigger */}
        <div
          ref={panelRef}
          style={panelStyle}
          className="border border-cream-12 rounded-xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col"
        >
          {/* Search input row */}
          <div
            className="p-3 border-b border-cream-12 shrink-0"
            style={{ background: PANEL_BG_HOVER }}
          >
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 border border-cream-12 focus-within:border-phase-green/40 transition-colors"
              style={{ background: PANEL_BG }}
            >
              <Search className="w-4 h-4 text-cream-40 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Type a name, address, or validator ID…"
                className="flex-1 bg-transparent text-cream text-sm font-body outline-none placeholder:text-cream-40"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="text-cream-40 hover:text-cream transition-colors shrink-0"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
                {filtered.length}
              </span>
            </div>
          </div>

          {/* Validator list */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ background: PANEL_BG }}
          >
            {filtered.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="text-cream-40 text-sm font-body">No validators match</div>
                <div className="text-cream-40 text-xs font-body mt-1">
                  Try a partial name or the full address
                </div>
              </div>
            ) : (
              filtered.map((v, idx) => {
                const isActive = idx === activeIdx;
                const isSelected = selected?.validatorId === v.validatorId;
                return (
                  <button
                    key={v.validatorId}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      onSelect(v);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-2"
                    style={{
                      background: isActive
                        ? PANEL_BG_HOVER
                        : isSelected
                        ? "rgba(74, 222, 128, 0.06)"
                        : PANEL_BG,
                      borderLeftColor: isSelected
                        ? "rgb(74, 222, 128)"
                        : "transparent",
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-cream-12"
                      style={{ background: PANEL_BG }}
                    >
                      <Server className="w-3.5 h-3.5 text-cream-60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-cream text-sm font-body font-medium truncate">
                          {v.name}
                        </span>
                        <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
                          #{v.validatorId}
                        </span>
                      </div>
                      <div className="text-cream-40 text-[11px] font-mono truncate mt-0.5">
                        {v.authAddress}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-cream text-xs font-body font-medium">
                        {formatStake(v.stakeMon)} MON
                      </div>
                      <div className="text-cream-40 text-[11px] font-body mt-0.5">
                        {v.commissionPct}% fee
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div
            className="px-3 py-2 border-t border-cream-12 flex items-center justify-between text-[10px] font-body text-cream-40 shrink-0"
            style={{ background: PANEL_BG_HOVER }}
          >
            <span className="flex items-center gap-3">
              <span><kbd className="font-mono text-cream-60">↑↓</kbd> nav</span>
              <span><kbd className="font-mono text-cream-60">↵</kbd> select</span>
              <span><kbd className="font-mono text-cream-60">esc</kbd> close</span>
            </span>
            <span>{validators.length} validators tracked</span>
          </div>
        </div>
      </>,
      document.body
    )
  ) : null;

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      {trigger}
      {portal}
    </div>
  );
}
