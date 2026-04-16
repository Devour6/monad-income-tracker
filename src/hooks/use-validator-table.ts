"use client";

import { useState, useMemo, useCallback } from "react";
import type { SortColumn, SortDirection, ValidatorData } from "@/lib/types";
import { VALIDATORS } from "@/data/validators";

interface ValidatorRow extends ValidatorData {
  profit: number;
  origIndex: number;
}

export function useValidatorTable(
  calcProfit: (
    totalStake: number,
    selfStake: number,
    commission: number
  ) => number
) {
  const [sortCol, setSortCol] = useState<SortColumn>("totalStake");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const sorted: ValidatorRow[] = useMemo(() => {
    // Build data with profits
    let data: ValidatorRow[] = VALIDATORS.map((v, i) => ({
      ...v,
      profit: calcProfit(v.totalStake, v.selfStake, v.commission),
      origIndex: i,
    }));

    // Filter by search
    const term = searchTerm.toLowerCase().trim();
    if (term) {
      data = data.filter((d) => d.name.toLowerCase().includes(term));
    }

    // Sort
    data.sort((a, b) => {
      let valA: string | number;
      let valB: string | number;
      switch (sortCol) {
        case "index":
          valA = a.origIndex;
          valB = b.origIndex;
          break;
        case "name":
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case "totalStake":
          valA = a.totalStake;
          valB = b.totalStake;
          break;
        case "selfStake":
          valA = a.selfStake;
          valB = b.selfStake;
          break;
        case "commission":
          valA = a.commission;
          valB = b.commission;
          break;
        case "profit":
          valA = a.profit;
          valB = b.profit;
          break;
        default:
          valA = a.totalStake;
          valB = b.totalStake;
      }
      if (sortCol === "name") {
        const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc"
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    });

    return data;
  }, [calcProfit, searchTerm, sortCol, sortDir]);

  const toggleSort = useCallback(
    (col: SortColumn) => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir(col === "name" || col === "index" ? "asc" : "desc");
      }
    },
    [sortCol]
  );

  return {
    sorted,
    sortCol,
    sortDir,
    searchTerm,
    selectedName,
    setSearchTerm,
    setSelectedName,
    toggleSort,
  };
}
