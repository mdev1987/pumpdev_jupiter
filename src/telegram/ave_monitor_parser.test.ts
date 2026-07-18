import { describe, expect, test } from "bun:test";
import { parseAveMonitorSignal } from "./ave_monitor_parser";

const vibeBuyGalo = `🪙 $GALOPÊRA (from pump.fun)
🔗 solana
CA: 7kbeJ6iaSote7kTutigCu2Nxe86h11cCxBbWqrskpump
Link: https://pro.ave.ai/token/7kbeJ6iaSote7kTutigCu2Nxe86h11cCxBbWqrskpump-solana

🔢 2nd Vibe Buy Signal
💹 Max Pump: < 1x
💰 3 KOL Wallet Buy
🤑 Current MC: 13.84K
💸 Total Buy 5.0800 SOL

🛗 Inflow
🟢 Mystayor 兽 💹🧲 Buy 1.466 SOL
🟢 fl0wjoe Buy 2.209 SOL
🟢 West Buy 1.4 SOL`;

const vibeBuyArm = `🪙 $Armstrung (from pump.fun)
🔗 solana
CA: DBa7KFfVdCWrTVZToQEgcWQXTNwgu29uUJgyaPugpump
Link: https://pro.ave.ai/token/DBa7KFfVdCWrTVZToQEgcWQXTNwgu29uUJgyaPugpump-solana

🔢 2nd Vibe Buy Signal
💹 Max Pump: < 1x
💰 2 Smart Wallet Buy
🤑 Current MC: 13.33K
💸 Total Buy 2.686 SOL

🛗 Inflow
🟢 Euris Buy 0.244 SOL
🟢 Setsu Buy 2.444 SOL`;

const pumpSignal = `🚀 x21 🚀 $NUBBY 🆙 🆙 🆙

Jumped from 3.09K to now 65.36K

CA: DUkPWeopcTygyMYM6K3qtzfXVD9fUeRAmuKM8inypump

Powered by @AveSignalMonitor 🤑`;

const vibeBuyActb = `🪙 $ACTB (from pump.fun)
🔗 solana
CA: FEFSnm2w255R1pD82Vs5tK1rGc8KdpzY7crFNqkKpump
Link: https://pro.ave.ai/token/FEFSnm2w255R1pD82Vs5tK1rGc8KdpzY7crFNqkKpump-solana

🔢 2nd Vibe Buy Signal
💹 Max Pump: 13x
💰 3 Smart Wallet Buy
🤑 Current MC: 96.36K
💸 Total Buy 6.358 SOL

🛗 Inflow
🟢 *X9vS Buy 2.778 SOL
🟢 *ZGJC Buy 0.828 SOL
🟢 *HqMi Buy 2.751 SOL`;

const vibeBuyJimothy = `🪙 $JIMOTHY (from pump.fun)
🔗 solana
CA: 2uW6qSx5qixb6GtUzL3UuaM11K6tQ231cwiPWLSvpump
Link: https://pro.ave.ai/token/2uW6qSx5qixb6GtUzL3UuaM11K6tQ231cwiPWLSvpump-solana

🔢 2nd Vibe Buy Signal
💹 Max Pump: 7x
💰 3 KOL Wallet Buy
🤑 Current MC: 65.73K
💸 Total Buy 13.304 SOL

🛗 Inflow
🟢 earl Buy 0.987 SOL
🟢 tobx Buy 2.412 SOL
🟢 West Buy 9.901 SOL`;

describe("Ave Monitor Parser", () => {
  test("parses $GALOPÊRA vibe buy signal", () => {
    const r = parseAveMonitorSignal(vibeBuyGalo);
    expect(r).not.toBeNull();
    expect(r!.token).toBe("GALOPÊRA");
    expect(r!.ca).toBe("7kbeJ6iaSote7kTutigCu2Nxe86h11cCxBbWqrskpump");
    expect(r!.signalType).toBe("vibe_buy");
    expect(r!.mcap).toBe(13840);
    expect(r!.walletCount).toBe(3);
    expect(r!.walletType).toBe("KOL");
    expect(r!.totalBuySol).toBeCloseTo(5.08);
    expect(r!.jumpFromMcap).toBeUndefined();
    expect(r!.jumpToMcap).toBeUndefined();
  });

  test("parses $Armstrung vibe buy with Smart wallets", () => {
    const r = parseAveMonitorSignal(vibeBuyArm);
    expect(r).not.toBeNull();
    expect(r!.token).toBe("Armstrung");
    expect(r!.ca).toBe("DBa7KFfVdCWrTVZToQEgcWQXTNwgu29uUJgyaPugpump");
    expect(r!.signalType).toBe("vibe_buy");
    expect(r!.mcap).toBe(13330);
    expect(r!.walletCount).toBe(2);
    expect(r!.walletType).toBe("Smart");
    expect(r!.totalBuySol).toBeCloseTo(2.686);
  });

  test("parses $NUBBY pump signal", () => {
    const r = parseAveMonitorSignal(pumpSignal);
    expect(r).not.toBeNull();
    expect(r!.token).toBe("NUBBY");
    expect(r!.ca).toBe("DUkPWeopcTygyMYM6K3qtzfXVD9fUeRAmuKM8inypump");
    expect(r!.signalType).toBe("pump");
    expect(r!.mcap).toBeUndefined();
    expect(r!.jumpFromMcap).toBe(3090);
    expect(r!.jumpToMcap).toBe(65360);
    expect(r!.walletCount).toBeUndefined();
    expect(r!.totalBuySol).toBeUndefined();
  });

  test("parses $ACTB vibe buy with Max Pump 13x", () => {
    const r = parseAveMonitorSignal(vibeBuyActb);
    expect(r).not.toBeNull();
    expect(r!.token).toBe("ACTB");
    expect(r!.ca).toBe("FEFSnm2w255R1pD82Vs5tK1rGc8KdpzY7crFNqkKpump");
    expect(r!.mcap).toBe(96360);
    expect(r!.walletCount).toBe(3);
    expect(r!.walletType).toBe("Smart");
    expect(r!.totalBuySol).toBeCloseTo(6.358);
  });

  test("parses $JIMOTHY vibe buy with 9.901 SOL inflow", () => {
    const r = parseAveMonitorSignal(vibeBuyJimothy);
    expect(r).not.toBeNull();
    expect(r!.token).toBe("JIMOTHY");
    expect(r!.ca).toBe("2uW6qSx5qixb6GtUzL3UuaM11K6tQ231cwiPWLSvpump");
    expect(r!.mcap).toBe(65730);
    expect(r!.walletCount).toBe(3);
    expect(r!.walletType).toBe("KOL");
    expect(r!.totalBuySol).toBeCloseTo(13.304);
  });

  test("returns null for empty input", () => {
    expect(parseAveMonitorSignal("")).toBeNull();
  });

  test("returns null for missing CA", () => {
    expect(parseAveMonitorSignal("Some random text without a CA")).toBeNull();
  });
});
