"use client";

import { useState } from "react";

const ASSUMPTIONS = [
  { label: "Block time", value: "0.4 seconds" },
  { label: "Blocks per day", value: "216,000" },
  { label: "Block reward", value: "25 MON" },
  { label: "Daily emission", value: "5,400,000 MON" },
  { label: "Annual inflation", value: "~1.97B MON (~2%)" },
  { label: "Max validator set", value: "200" },
  { label: "Min self-stake", value: "100,000 MON" },
  { label: "Min total stake", value: "10,000,000 MON" },
  { label: "Unbonding period", value: "~5.5 hours (1 epoch)" },
  { label: "Slashing", value: "Not active (protocol level)" },
  { label: "VDP commission", value: "20% (mandatory ~6 months)" },
  { label: "Priority fees", value: "Excluded (variable, paid to proposer)" },
  { label: "Base fee", value: "Burned (EIP-1559, not validator revenue)" },
];

export function KeyAssumptions() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-cream-5 border border-cream-8 rounded-2xl card-hover">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-6 cursor-pointer"
        aria-expanded={open}
      >
        <h2 className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-40">
          Key Assumptions
        </h2>
        <svg
          className={`w-4 h-4 text-cream-40 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6">
            <table className="w-full border-collapse">
              <caption className="sr-only">Key network assumptions</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {ASSUMPTIONS.map((row) => (
                  <tr key={row.label} className="border-b border-cream-5 last:border-0">
                    <th scope="row" className="py-[9px] text-[13px] font-normal text-cream-40 text-left">
                      {row.label}
                    </th>
                    <td className="py-[9px] text-[13px] font-semibold text-cream-60 text-right">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
