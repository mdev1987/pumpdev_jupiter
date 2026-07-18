export interface AveMonitorSignal {
  token: string;
  ca: string;
  signalType: "vibe_buy" | "pump";
  mcap?: number;
  totalBuySol?: number;
  walletCount?: number;
  walletType?: string;
  jumpFromMcap?: number;
  jumpToMcap?: number;
}

function parseHumanNumber(val: string | undefined, suffix: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = Number(val);
  switch ((suffix ?? "").toUpperCase()) {
    case "K": return n * 1e3;
    case "M": return n * 1e6;
    case "B": return n * 1e9;
    default: return n;
  }
}

export function parseAveMonitorSignal(raw: string): AveMonitorSignal | null {
  const text = raw.replace(/\r\n/g, "\n");

  const caMatch = text.match(/CA:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (!caMatch) return null;
  const ca = caMatch[1]!;

  const isPumpSignal = text.includes("🚀");
  const signalType: "vibe_buy" | "pump" = isPumpSignal ? "pump" : "vibe_buy";

  const symMatch = text.match(/\$([^\s)\]]+)/);
  const token = symMatch?.[1] ?? "Unknown";

  const mcMatch = text.match(/Current MC:\s*\$?([\d.]+)\s*([KMB]?)/);
  const mcap = mcMatch ? parseHumanNumber(mcMatch[1]!, mcMatch[2]) : undefined;

  let walletCount: number | undefined;
  let walletType: string | undefined;
  const walletMatch = text.match(/💰\s*(\d+)\s*(KOL|Smart)\s*Wallet/);
  if (walletMatch) {
    walletCount = Number(walletMatch[1]!);
    walletType = walletMatch[2]!;
  }

  const buyMatch = text.match(/Total Buy\s*([\d.]+)\s*SOL/);
  const totalBuySol = buyMatch ? Number(buyMatch[1]!) : undefined;

  const jumpMatch = text.match(/Jumped from\s*([\d.]+)([KMB]?)\s*to now\s*([\d.]+)([KMB]?)/);
  const jumpFromMcap = jumpMatch ? parseHumanNumber(jumpMatch[1]!, jumpMatch[2]) : undefined;
  const jumpToMcap = jumpMatch ? parseHumanNumber(jumpMatch[3]!, jumpMatch[4]) : undefined;

  return { token, ca, signalType, mcap, totalBuySol, walletCount, walletType, jumpFromMcap, jumpToMcap };
}
