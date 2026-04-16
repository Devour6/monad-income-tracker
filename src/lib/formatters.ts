export function fmt(n: number, decimals = 0): string {
  if (!isFinite(n)) return "\u2014";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCompact(n: number): string {
  if (!isFinite(n)) return "\u2014";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

export function fmtUsd(n: number): string {
  if (!isFinite(n)) return "$\u2014";
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1000) return "$" + fmt(n, 0);
  return "$" + fmt(n, 2);
}

export function fmtPercent(n: number, decimals = 2): string {
  if (!isFinite(n)) return "\u2014";
  return n.toFixed(decimals) + "%";
}
