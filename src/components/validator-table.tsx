"use client";

import type { SortColumn, SortDirection } from "@/lib/types";
import { fmtCompact, fmtUsd } from "@/lib/formatters";
import { profitColor } from "@/lib/calculations";

interface ValidatorRow {
  name: string;
  totalStake: number;
  selfStake: number;
  commission: number;
  profit: number;
  origIndex: number;
}

interface ValidatorTableProps {
  sorted: ValidatorRow[];
  sortCol: SortColumn;
  sortDir: SortDirection;
  searchTerm: string;
  selectedName: string | null;
  setSearchTerm: (term: string) => void;
  onRowClick: (name: string, totalStake: number, selfStake: number, commission: number) => void;
  toggleSort: (col: SortColumn) => void;
}

const COLUMNS: { col: SortColumn; label: string; align?: string }[] = [
  { col: "index", label: "#", align: "center" },
  { col: "name", label: "Validator" },
  { col: "totalStake", label: "Total Stake", align: "right" },
  { col: "selfStake", label: "Self Stake", align: "right" },
  { col: "commission", label: "Commission", align: "right" },
  { col: "profit", label: "Est. Annual Profit", align: "right" },
];

export function ValidatorTable({
  sorted,
  sortCol,
  sortDir,
  searchTerm,
  selectedName,
  setSearchTerm,
  onRowClick,
  toggleSort,
}: ValidatorTableProps) {
  return (
    <div
      className="bg-cream-5 border border-cream-8 rounded-2xl p-6 opacity-0 animate-fade-in-up"
      style={{ animationDelay: "0.32s" }}
    >

      <h2 className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-40 mb-5">
        Active Validators
      </h2>

      {/* Search */}
      <div className="relative mb-[18px]">
        <svg
          aria-hidden="true"
          className="absolute top-1/2 left-[14px] -translate-y-1/2 w-4 h-4 text-cream-40 pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          aria-label="Search validators"
          className="w-full py-3 pr-4 pl-10 bg-dark border border-cream-8 rounded-[10px] text-cream text-sm font-body font-normal outline-none transition-all placeholder:text-cream-20 focus:border-cream-20"
          placeholder="Search validators..."
          autoComplete="off"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="max-h-[560px] overflow-y-auto overflow-x-auto rounded-xl border border-cream-8 scrollbar-thin">
        <table className="w-full border-collapse min-w-[680px]">
          <thead className="sticky top-0 z-[2]">
            <tr>
              {COLUMNS.map(({ col, label, align }) => (
                <th
                  key={col}
                  role="button"
                  tabIndex={0}
                  aria-sort={sortCol === col ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  className={`font-display text-[10px] font-normal uppercase tracking-[0.08em] text-cream-40 py-[14px] px-4 bg-dark border-b border-cream-8 whitespace-nowrap cursor-pointer select-none transition-colors hover:text-cream-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-40 ${
                    align === "center"
                      ? "text-center w-[44px]"
                      : align === "right"
                      ? "text-right"
                      : "text-left"
                  } ${sortCol === col ? "text-cream-60" : ""}`}
                  onClick={() => toggleSort(col)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(col); } }}
                >
                  {label}{" "}
                  <span
                    className={`inline-block ml-1 text-[9px] transition-opacity ${
                      sortCol === col ? "opacity-100 text-cream" : "opacity-40"
                    }`}
                  >
                    {sortCol === col
                      ? sortDir === "asc"
                        ? "\u25B2"
                        : "\u25BC"
                      : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} role="status" className="py-8 text-center text-cream-20 text-sm font-body">No validators found</td></tr>
            )}
            {sorted.map((d, j) => (
              <tr
                key={d.name}
                role="button"
                tabIndex={0}
                aria-label={`Select validator ${d.name}`}
                className={`cursor-pointer transition-all border-b border-cream-5 border-l-[3px] hover:bg-cream-5 focus-visible:bg-cream-5 focus-visible:outline-none opacity-0 animate-row-fade ${
                  d.name === selectedName
                    ? "bg-cream-8 border-l-phase-green"
                    : "border-l-transparent"
                }`}
                style={{
                  animationDelay: `${Math.min(j * 12, 600)}ms`,
                }}
                onClick={() =>
                  onRowClick(d.name, d.totalStake, d.selfStake, d.commission)
                }
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(d.name, d.totalStake, d.selfStake, d.commission); } }}
              >
                <td className="py-[11px] px-4 text-[11px] font-light text-cream-20 text-center">
                  {j + 1}
                </td>
                <td className="py-[11px] px-4 text-[13px] font-medium text-cream whitespace-nowrap">
                  {d.name}
                </td>
                <td className="py-[11px] px-4 text-[13px] font-normal text-cream-60 text-right whitespace-nowrap">
                  {fmtCompact(d.totalStake)}
                </td>
                <td className="py-[11px] px-4 text-[13px] font-normal text-cream-60 text-right whitespace-nowrap">
                  {fmtCompact(d.selfStake)}
                </td>
                <td className="py-[11px] px-4 text-[13px] font-normal text-cream-60 text-right whitespace-nowrap">
                  {d.commission}%
                </td>
                <td
                  className="py-[11px] px-4 text-[13px] font-semibold text-right whitespace-nowrap"
                  style={{ color: profitColor(d.profit) }}
                >
                  {fmtUsd(d.profit)}/yr
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-[14px] text-[11px] text-cream-20 font-light leading-[1.5]">
        On-chain data — updates when live data is available. Click any row to load into
        calculator. Profit assumes default cost structure below.
      </p>
    </div>
  );
}
