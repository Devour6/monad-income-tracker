"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { CalculatorInputs, CalculatorResults, Verdict, PresetConfig } from "@/lib/types";
import { DEFAULT_INPUTS, PRESETS } from "@/lib/constants";
import { calculateProfit, getVerdict, calculateBreakevenStake } from "@/lib/calculations";
import type { LiveData } from "@/hooks/use-live-data";

export function useCalculator(liveData?: LiveData | null) {
  const [inputs, setInputs] = useState<CalculatorInputs>(() => {
    const defaults = { ...DEFAULT_INPUTS };
    defaults.stake = calculateBreakevenStake(
      defaults.selfStake, defaults.commission, defaults.monPrice,
      defaults.networkStake, defaults.priorityFees,
      defaults.serverCost, defaults.otherCosts
    );
    return defaults;
  });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isBreakeven, setIsBreakeven] = useState(true);
  const [lastLiveTs, setLastLiveTs] = useState<string | null>(null);

  // When live data arrives (or refreshes), update economic params
  useEffect(() => {
    if (!liveData?.updatedAt || liveData.updatedAt === lastLiveTs) return;
    setLastLiveTs(liveData.updatedAt);
    setInputs(prev => ({
      ...prev,
      monPrice: liveData.monPrice,
      networkStake: liveData.networkStake,
      activeValidators: liveData.activeValidators,
    }));
  }, [liveData, lastLiveTs]);

  // Auto-update stake to breakeven when economic params change
  useEffect(() => {
    if (!isBreakeven) return;
    const breakevenStake = calculateBreakevenStake(
      inputs.selfStake, inputs.commission, inputs.monPrice,
      inputs.networkStake, inputs.priorityFees,
      inputs.serverCost, inputs.otherCosts
    );
    const rounded = Math.round(breakevenStake);
    setInputs(prev => {
      if (prev.stake === rounded) return prev;
      return { ...prev, stake: rounded };
    });
  }, [isBreakeven, inputs.selfStake, inputs.commission, inputs.monPrice,
      inputs.networkStake, inputs.priorityFees, inputs.serverCost, inputs.otherCosts]);

  const results: CalculatorResults = useMemo(
    () => calculateProfit(inputs),
    [inputs]
  );

  const verdict: Verdict = useMemo(
    () => isBreakeven ? "breakeven" : getVerdict(results.netProfitUsd),
    [isBreakeven, results.netProfitUsd]
  );

  const updateInput = useCallback(
    (key: keyof CalculatorInputs, value: number) => {
      if (key === 'stake') {
        setIsBreakeven(false);
        setActivePreset(null);
      }
      setInputs((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const applyPreset = useCallback((preset: PresetConfig | null) => {
    if (!preset) {
      setActivePreset(null);
      setIsBreakeven(true);
      return;
    }
    setActivePreset(preset.id);
    setIsBreakeven(false);
    setInputs((prev) => ({
      ...prev,
      stake: preset.stake,
      selfStake: preset.selfStake,
      commission: preset.commission,
    }));
  }, []);

  const loadValidator = useCallback(
    (totalStake: number, selfStake: number, commission: number) => {
      setActivePreset(null);
      setIsBreakeven(false);
      setInputs((prev) => ({
        ...prev,
        stake: Math.round(totalStake),
        selfStake: Math.round(selfStake),
        commission,
      }));
    },
    []
  );

  return {
    inputs,
    results,
    verdict,
    activePreset,
    presets: PRESETS,
    updateInput,
    applyPreset,
    loadValidator,
  };
}
