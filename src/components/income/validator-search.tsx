"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

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

function fmtStake(mon: number): string {
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(2)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(0)}K`;
  return mon.toFixed(0);
}

const PANEL = "#161513";
const PANEL_HOVER = "#1f1d1a";
const SCRIM = "rgba(15, 14, 12, 0.92)";

/**
 * Validator search.
 *
 * - Trigger is a single solid input row in the page flow.
 * - Dropdown is portaled to document.body with a full-viewport scrim so
 *   nothing underneath bleeds through.
 * - Keyboard-driven: ↑↓ navigate, ↵ select, esc close.
 */
export function ValidatorSearch({
  validators,
  selected,
  onSelect,
}: ValidatorSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function update() {
      if (triggerRef.current) {
        setAnchor(triggerRef.current.getBoundingClientRect());
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

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

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

  const trigger = (
    <button
      ref={triggerRef}
      onClick={() => setOpen((o) => !o)}
      className="group w-full flex items-center gap-3 border border-cream-12 rounded-xl px-4 py-3.5 text-left hover:border-phase-green/40 transition-colors"
      style={{ background: PANEL }}
    >
      <Search className="w-4 h-4 text-cream-40 shrink-0" />
      {selected ? (
        <span className="flex-1 flex items-center justify-between min-w-0 gap-3">
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-cream font-body text-sm font-medium truncate">
              {selected.name}
            </span>
            <span className="text-cream-40 text-[10px] font-mono shrink-0">
              #{selected.validatorId}
            </span>
          </span>
          <span className="text-cream-60 text-xs font-body shrink-0">
            {fmtStake(selected.stakeMon)} MON · {selected.commissionPct}%
          </span>
        </span>
      ) : (
        <span className="flex-1 text-cream-40 text-sm font-body">
          Search any validator…
        </span>
      )}
      <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
        {validators.length}
      </span>
    </button>
  );

  const panelStyle: React.CSSProperties = anchor
    ? {
        position: "fixed",
        top: anchor.bottom + 8,
        left: anchor.left,
        width: anchor.width,
        background: PANEL,
        maxHeight: `min(520px, calc(100vh - ${anchor.bottom + 24}px))`,
        zIndex: 1001,
      }
    : { display: "none" };

  const portal =
    open && mounted
      ? createPortal(
          <>
            <div
              aria-hidden
              style={{
                position: "fixed",
                inset: 0,
                background: SCRIM,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                zIndex: 1000,
              }}
              onClick={() => setOpen(false)}
            />
            <div
              ref={panelRef}
              style={panelStyle}
              className="border border-cream-12 rounded-xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col"
            >
              <div
                className="p-3 border-b border-cream-12 shrink-0"
                style={{ background: PANEL_HOVER }}
              >
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2 border border-cream-12 focus-within:border-phase-green/40 transition-colors"
                  style={{ background: PANEL }}
                >
                  <Search className="w-4 h-4 text-cream-40 shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Name, address, or validator ID…"
                    className="flex-1 bg-transparent text-cream text-sm font-body outline-none placeholder:text-cream-40"
                  />
                  {query && (
                    <button
                      onClick={() => {
                        setQuery("");
                        inputRef.current?.focus();
                      }}
                      className="text-cream-40 hover:text-cream transition-colors shrink-0"
                      aria-label="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
                    {filtered.length}
                  </span>
                </div>
              </div>

              <div
                className="flex-1 overflow-y-auto"
                style={{ background: PANEL }}
              >
                {filtered.length === 0 ? (
                  <div className="text-center py-12 px-4 text-cream-40 text-sm font-body">
                    No validators match
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
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-l-2"
                        style={{
                          background: isActive
                            ? PANEL_HOVER
                            : isSelected
                            ? "rgba(74, 222, 128, 0.06)"
                            : PANEL,
                          borderLeftColor: isSelected
                            ? "rgb(74, 222, 128)"
                            : "transparent",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-cream text-sm font-body font-medium truncate">
                              {v.name}
                            </span>
                            <span className="text-cream-40 text-[10px] font-mono shrink-0">
                              #{v.validatorId}
                            </span>
                          </div>
                          <div className="text-cream-40 text-[11px] font-mono truncate mt-0.5">
                            {v.authAddress}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-cream text-xs font-body">
                            {fmtStake(v.stakeMon)} MON
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

              <div
                className="px-3 py-2 border-t border-cream-12 shrink-0 text-[10px] font-body text-cream-40 flex items-center gap-3"
                style={{ background: PANEL_HOVER }}
              >
                <span>
                  <kbd className="font-mono text-cream-60">↑↓</kbd> nav
                </span>
                <span>
                  <kbd className="font-mono text-cream-60">↵</kbd> select
                </span>
                <span>
                  <kbd className="font-mono text-cream-60">esc</kbd> close
                </span>
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div className="relative w-full">
      {trigger}
      {portal}
    </div>
  );
}
