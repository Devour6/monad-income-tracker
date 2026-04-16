"use client";

import type { CalculatorInputs, PresetConfig } from "@/lib/types";

interface CalculatorFormProps {
  inputs: CalculatorInputs;
  activePreset: string | null;
  presets: PresetConfig[];
  updateInput: (key: keyof CalculatorInputs, value: number) => void;
  applyPreset: (preset: PresetConfig) => void;
}

function sanitize(value: string, fallback = 0): number {
  const raw = parseFloat(value);
  return isFinite(raw) ? Math.max(0, raw) : fallback;
}

export function CalculatorForm({
  inputs,
  activePreset,
  presets,
  updateInput,
  applyPreset,
}: CalculatorFormProps) {
  return (
    <div
      className="bg-cream-5 border border-cream-8 rounded-2xl p-6"
      style={{ animation: "fadeInUp 0.6s cubic-bezier(0.22,1,0.36,1) 0.32s forwards, glowPulse 3s ease-in-out 1s infinite", opacity: 0 }}
    >

      <h2 className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-40 mb-5">
        Validator Parameters
      </h2>

      {/* Presets */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {presets.map((p) => (
          <button
            key={p.id}
            aria-pressed={activePreset === p.id}
            className={`px-[14px] py-[7px] rounded-lg text-xs font-body font-medium cursor-pointer transition-all border btn-press ${
              activePreset === p.id
                ? "border-cream-40 bg-cream-12 text-cream"
                : "bg-cream-5 border-cream-8 text-cream-40 hover:border-cream-20 hover:text-cream hover:bg-cream-8"
            }`}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Total Validator Stake */}
      <div className="mb-4">
        <label htmlFor="stake" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Total Validator Stake (MON)
          <span className="text-[11px] text-cream-20 font-light">
            Min 10M to activate
          </span>
        </label>
        <input
          id="stake"
          type="number"
          aria-label="Total Validator Stake"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.stake}
          min={10000000}
          step={1000000}
          onChange={(e) =>
            updateInput("stake", sanitize(e.target.value))
          }
        />
      </div>

      {/* Self-Stake */}
      <div className="mb-4">
        <label htmlFor="selfStake" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Self-Stake (MON)
          <span className="text-[11px] text-cream-20 font-light">
            Min 100K required
          </span>
        </label>
        <input
          id="selfStake"
          type="number"
          aria-label="Self-Stake"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.selfStake}
          min={100000}
          step={100000}
          onChange={(e) =>
            updateInput("selfStake", sanitize(e.target.value))
          }
        />
      </div>

      {/* Commission */}
      <div className="mb-4">
        <label htmlFor="commission" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Commission Rate
          <span className="text-[11px] text-cream-20 font-light">
            VDP cap: 20% (first 6mo) / 10%
          </span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="commission"
            type="range"
            aria-label="Commission Rate"
            aria-valuetext={`${inputs.commission}%`}
            className="flex-1"
            min={0}
            max={100}
            value={inputs.commission}
            onChange={(e) =>
              updateInput("commission", sanitize(e.target.value))
            }
          />
          <span className="min-w-[50px] text-right text-sm font-semibold text-cream">
            {inputs.commission}%
          </span>
        </div>
      </div>

      {/* MON Price */}
      <div className="mb-4">
        <label htmlFor="monPrice" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          MON Price (USD)
        </label>
        <input
          id="monPrice"
          type="number"
          aria-label="MON Price"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.monPrice}
          min={0.001}
          step={0.001}
          onChange={(e) =>
            updateInput("monPrice", sanitize(e.target.value))
          }
        />
      </div>

      {/* Section: Network Assumptions */}
      <div className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-20 mt-6 mb-3 pt-4 border-t border-cream-8">
        Network Assumptions
      </div>

      {/* Total Network Staked */}
      <div className="mb-4">
        <label htmlFor="networkStake" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Total Network Staked (MON)
          <span className="text-[11px] text-cream-20 font-light">
            ~12.36B on-chain
          </span>
        </label>
        <input
          id="networkStake"
          type="number"
          aria-label="Total Network Staked"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.networkStake}
          min={100000000}
          step={100000000}
          onChange={(e) =>
            updateInput("networkStake", sanitize(e.target.value, 1))
          }
        />
      </div>

      {/* Active Validators */}
      <div className="mb-4">
        <label htmlFor="activeValidators" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Active Validators
        </label>
        <input
          id="activeValidators"
          type="number"
          aria-label="Active Validators"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.activeValidators}
          min={1}
          max={200}
          onChange={(e) =>
            updateInput("activeValidators", sanitize(e.target.value, 1))
          }
        />
      </div>

      {/* Priority Fees */}
      <div className="mb-4">
        <label htmlFor="priorityFees" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Priority Fee Revenue (MON/day)
          <span className="text-[11px] text-cream-20 font-light">
            Highly variable
          </span>
        </label>
        <input
          id="priorityFees"
          type="number"
          aria-label="Priority Fee Revenue"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.priorityFees}
          min={0}
          step={100}
          onChange={(e) =>
            updateInput("priorityFees", sanitize(e.target.value))
          }
        />
      </div>

      {/* Section: Operating Costs */}
      <div className="font-display text-[11px] font-normal uppercase tracking-[0.12em] text-cream-20 mt-6 mb-3 pt-4 border-t border-cream-8">
        Operating Costs
      </div>

      {/* Server Cost */}
      <div className="mb-4">
        <label htmlFor="serverCost" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Monthly Server Cost (USD)
          <span className="text-[11px] text-cream-20 font-light">
            ~$583/mo ($7K/yr)
          </span>
        </label>
        <input
          id="serverCost"
          type="number"
          aria-label="Monthly Server Cost"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.serverCost}
          min={0}
          step={25}
          onChange={(e) =>
            updateInput("serverCost", sanitize(e.target.value))
          }
        />
      </div>

      {/* Other Costs */}
      <div className="mb-4">
        <label htmlFor="otherCosts" className="flex justify-between items-center text-[13px] text-cream-60 mb-[7px] font-normal">
          Other Monthly Costs (USD)
          <span className="text-[11px] text-cream-20 font-light">
            Monitoring, bandwidth, etc.
          </span>
        </label>
        <input
          id="otherCosts"
          type="number"
          aria-label="Other Monthly Costs"
          className="w-full py-[11px] px-[14px] bg-dark border border-cream-8 rounded-lg text-cream text-sm font-body font-normal outline-none transition-all focus:border-cream-20"
          value={inputs.otherCosts}
          min={0}
          step={10}
          onChange={(e) =>
            updateInput("otherCosts", sanitize(e.target.value))
          }
        />
      </div>
    </div>
  );
}
