"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Server } from "lucide-react";

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
  if (mon >= 1_000_000_000) return `${(mon / 1_000_000_000).toFixed(1)}B`;
  if (mon >= 1_000_000) return `${(mon / 1_000_000).toFixed(1)}M`;
  if (mon >= 1_000) return `${(mon / 1_000).toFixed(1)}K`;
  return mon.toFixed(0);
}

export function ValidatorSearch({
  validators,
  selected,
  onSelect,
}: ValidatorSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const filtered = validators.filter(
    (v) =>
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      v.authAddress.toLowerCase().includes(query.toLowerCase()) ||
      v.validatorId.toString().includes(query)
  );

  return (
    <div ref={ref} className="relative w-full max-w-xl mx-auto">
      {/* Trigger / Selected display */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 bg-cream-5 border border-cream-8 rounded-xl px-4 py-3 text-left hover:border-cream-12 transition-colors"
      >
        <Search className="w-4 h-4 text-cream-40 shrink-0" />
        {selected ? (
          <div className="flex-1 flex items-center justify-between">
            <div>
              <span className="text-cream font-body text-sm font-medium">
                {selected.name}
              </span>
              <span className="text-cream-20 text-xs font-mono ml-2">
                #{selected.validatorId}
              </span>
            </div>
            <div className="flex items-center gap-3 text-cream-40 text-xs font-body">
              <span>{formatStake(selected.stakeMon)} MON</span>
              <span>{selected.commissionPct}%</span>
            </div>
          </div>
        ) : (
          <span className="flex-1 text-cream-40 text-sm font-body">
            Search validators by name, address, or ID...
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-cream-20 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-dark border border-cream-8 rounded-xl overflow-hidden shadow-2xl z-50">
          {/* Search input */}
          <div className="p-3 border-b border-cream-8">
            <div className="flex items-center gap-2 bg-cream-5 rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-cream-40" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent text-cream text-sm font-body outline-none placeholder:text-cream-20"
              />
            </div>
          </div>

          {/* Validator list */}
          <div className="max-h-80 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-cream-20 text-sm font-body">
                No validators found
              </div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.validatorId}
                  onClick={() => {
                    onSelect(v);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-cream-5 transition-colors ${
                    selected?.validatorId === v.validatorId ? "bg-cream-8" : ""
                  }`}
                >
                  <Server className="w-4 h-4 text-cream-20 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-cream text-sm font-body font-medium truncate">
                        {v.name}
                      </span>
                      <span className="text-cream-20 text-xs font-mono shrink-0">
                        #{v.validatorId}
                      </span>
                    </div>
                    <div className="text-cream-20 text-xs font-mono truncate mt-0.5">
                      {v.authAddress}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-cream-40 text-xs font-body">
                      {formatStake(v.stakeMon)} MON
                    </div>
                    <div className="text-cream-20 text-xs font-body">
                      {v.commissionPct}% fee
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
