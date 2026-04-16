"use client";

import type { CalculatorInputs, PresetConfig } from "@/lib/types";
import { fmtCompact } from "@/lib/formatters";

interface InputCardsProps {
  inputs: CalculatorInputs;
  activePreset: string | null;
  presets: PresetConfig[];
  updateInput: (key: keyof CalculatorInputs, value: number) => void;
  applyPreset: (preset: PresetConfig | null) => void;
}

function sanitize(value: string, fallback = 0): number {
  const raw = parseFloat(value);
  return isFinite(raw) ? Math.max(0, raw) : fallback;
}

export function InputCards({
  inputs,
  activePreset,
  presets,
  updateInput,
  applyPreset,
}: InputCardsProps) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-3 gap-6 opacity-0 animate-fade-in-up"
      style={{ animationDelay: "0.4s" }}
    >
      {/* STAKE card */}
      <div className="bg-cream-5 border border-cream-8 rounded-2xl p-5 card-hover">
        <CardHeader icon="stake" label="Stake" />

        {/* VDP Tier presets */}
        <div className="text-[11px] text-cream-20 mb-2 font-light">VDP TIER</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {presets.filter(p => p.id !== "custom").map((p) => (
            <button
              key={p.id}
              aria-pressed={activePreset === p.id}
              className={`px-3 py-[7px] rounded-lg text-xs font-body font-medium cursor-pointer transition-all border btn-press ${
                activePreset === p.id
                  ? "border-phase-green bg-phase-green/15 text-phase-green"
                  : "bg-cream-5 border-cream-8 text-cream-40 hover:border-cream-20 hover:text-cream"
              }`}
              onClick={() => applyPreset(activePreset === p.id ? null : p)}
            >
              {p.label.replace("VDP ", "")}: {fmtCompact(p.stake)}
            </button>
          ))}
        </div>

        <InputField
          label="Total Validator Stake"
          id="stake"
          value={inputs.stake}
          suffix="MON"
          min={0}
          step={1000000}
          onChange={(v) => updateInput("stake", v)}
        />

        <InputField
          label="Self-Stake"
          id="selfStake"
          value={inputs.selfStake}
          suffix="MON"
          min={0}
          step={100000}
          onChange={(v) => updateInput("selfStake", v)}
        />

        <InputField
          label="Commission Rate"
          id="commission"
          value={inputs.commission}
          suffix="%"
          min={0}
          max={100}
          step={1}
          onChange={(v) => updateInput("commission", v)}
        />
      </div>

      {/* REVENUE & COSTS card */}
      <div className="bg-cream-5 border border-cream-8 rounded-2xl p-5 card-hover">
        <CardHeader icon="costs" label="Revenue & Costs" />

        <InputField
          label="Priority Fee Revenue"
          id="priorityFees"
          value={inputs.priorityFees}
          suffix="MON/DAY"
          min={0}
          step={100}
          onChange={(v) => updateInput("priorityFees", v)}
        />

        <InputField
          label="Monthly Server Cost"
          id="serverCost"
          value={inputs.serverCost}
          suffix="$/MO"
          min={0}
          step={50}
          onChange={(v) => updateInput("serverCost", v)}
        />

        <InputField
          label="Other Monthly Costs"
          id="otherCosts"
          value={inputs.otherCosts}
          suffix="$/MO"
          min={0}
          step={50}
          onChange={(v) => updateInput("otherCosts", v)}
        />

        <InputField
          label="MON Price"
          id="monPrice"
          value={inputs.monPrice}
          suffix="$"
          min={0.001}
          step={0.001}
          onChange={(v) => updateInput("monPrice", v)}
        />
      </div>

      {/* NETWORK card */}
      <div className="bg-cream-5 border border-cream-8 rounded-2xl p-5 card-hover">
        <CardHeader icon="network" label="Network Assumptions" />

        <InputField
          label="Total Network Staked"
          id="networkStake"
          value={inputs.networkStake}
          suffix="MON"
          min={100000000}
          step={100000000}
          onChange={(v) => updateInput("networkStake", v)}
        />

        <InputField
          label="Active Validators"
          id="activeValidators"
          value={inputs.activeValidators}
          suffix=""
          min={1}
          max={200}
          step={1}
          onChange={(v) => updateInput("activeValidators", v)}
        />

        <InputField
          label="Epochs / Year"
          id="epochsYear"
          value={1593}
          suffix=""
          min={1}
          step={1}
          onChange={() => {}}
          disabled
        />
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─── */

function CardHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon === "stake" && (
        <svg className="w-4 h-4 text-cream-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75" />
        </svg>
      )}
      {icon === "costs" && (
        <svg className="w-4 h-4 text-cream-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      {icon === "network" && (
        <svg className="w-4 h-4 text-cream-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      )}
      <span className="font-display text-[11px] uppercase tracking-[0.12em] text-cream-40 font-normal">
        {label}
      </span>
    </div>
  );
}

function InputField({
  label,
  id,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  id: string;
  value: number;
  suffix: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="text-[11px] text-cream-20 mb-[5px] block font-light">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          disabled={disabled}
          className="w-full py-[10px] px-[12px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20 pr-16 disabled:opacity-40"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(sanitize(e.target.value))}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-cream-20 font-light pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
