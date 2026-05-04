"use client";

/**
 * Validator search — single-input combobox.
 *
 * The visible field IS the input. Type to search, results portal below.
 * Both the input and the dropdown use a solid hex background (#0F0E0C)
 * so the aurora/particles never bleed through.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, Server, X } from "lucide-react";

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

// Solid surfaces. Hex on style attribute beats Tailwind class precedence and
// guarantees no transparency bleed against the animated background.
const PANEL_BG = "#0F0E0C";
const PANEL_BG_HOVER = "#1B1916";
const PANEL_BORDER = "rgba(243, 238, 217, 0.12)";

function formatStake(mon: number): string {
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(2)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(1)}K`;
  return mon.toFixed(0);
}

export function ValidatorSearch({
  validators,
  selected,
  onSelect,
}: ValidatorSearchProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!focused) return;
    function update() {
      if (wrapRef.current) {
        setAnchorRect(wrapRef.current.getBoundingClientRect());
      }
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [focused]);

  useEffect(() => {
    if (!focused) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setFocused(false);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [focused]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return validators.slice(0, 50);
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
      setFocused(true);
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) {
        onSelect(pick);
        setQuery("");
        setFocused(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  const displayValue = focused
    ? query
    : selected
    ? `${selected.name}  ·  #${selected.validatorId}`
    : query;

  const panelStyle: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: anchorRect.bottom + 6,
        left: anchorRect.left,
        width: anchorRect.width,
        zIndex: 60,
        background: PANEL_BG,
        borderColor: PANEL_BORDER,
      }
    : { display: "none" };

  const list = focused && (
    <div
      ref={listRef}
      style={panelStyle}
      className="border rounded-xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.8)]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        className="max-h-[55vh] overflow-y-auto"
        style={{ background: PANEL_BG }}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-cream-40 text-sm font-body">
            No validators found
          </div>
        ) : (
          filtered.map((v, idx) => {
            const isActive = idx === activeIdx;
            const isSelected = selected?.validatorId === v.validatorId;
            return (
              <button
                key={v.validatorId}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(v);
                  setQuery("");
                  setFocused(false);
                  inputRef.current?.blur();
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-cream-8 last:border-b-0"
                style={{
                  background: isActive
                    ? PANEL_BG_HOVER
                    : isSelected
                    ? "rgba(74, 222, 128, 0.08)"
                    : PANEL_BG,
                }}
              >
                <Server className="w-4 h-4 text-cream-40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-cream text-sm font-body font-medium truncate">
                      {v.name}
                    </span>
                    <span className="text-cream-40 text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border border-cream-12">
                      #{v.validatorId}
                    </span>
                  </div>
                  <div className="text-cream-40 text-xs font-mono truncate mt-0.5">
                    {v.authAddress}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-cream text-xs font-body font-medium">
                    {formatStake(v.stakeMon)} MON
                  </div>
                  <div className="text-cream-40 text-[11px] font-body">
                    {v.commissionPct}% fee
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div
        className="px-4 py-2 border-t border-cream-12 flex items-center gap-3 text-cream-40 text-[10px] font-body"
        style={{ background: PANEL_BG_HOVER }}
      >
        <span>↑↓ navigate</span>
        <span>·</span>
        <span>↵ select</span>
        <span>·</span>
        <span>esc close</span>
      </div>
    </div>
  );

  return (
    <>
      <div ref={wrapRef} className="relative w-full">
        <div
          className="flex items-center gap-3 border rounded-xl px-5 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] focus-within:border-phase-green/40 transition-colors"
          style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}
        >
          <Search className="w-4 h-4 text-cream-40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={displayValue}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocused(true);
            }}
            onFocus={() => {
              if (selected) setQuery("");
              setFocused(true);
            }}
            onKeyDown={handleKey}
            placeholder="Search any validator by name, address, or ID…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent text-cream text-sm font-body outline-none placeholder:text-cream-40 min-w-0"
          />
          {(query || selected) && (
            <button
              type="button"
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
            {validators.length}
          </span>
        </div>
      </div>
      {mounted && list ? createPortal(list, document.body) : null}
    </>
  );
}
