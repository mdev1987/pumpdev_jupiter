import { interval, Subscription } from "rxjs";
import { CONFIG } from "../config";
import { PositionManager } from "./position";
import { PaperExecutor } from "./paper_executor";
import { evaluateExit } from "./risk";
import { PriceRouter } from "./price_provider";

export class PriceTracker {
  private sub: Subscription | null = null;

  constructor(
    private positions: PositionManager,
    private executor: PaperExecutor,
    private prices: PriceRouter,
  ) {}

  start() {
    this.sub = interval(CONFIG.pricePollIntervalMs).subscribe(() => {
      this.tick();
    });
    console.log(`[PriceTracker] Started (every ${CONFIG.pricePollIntervalMs}ms)`);
  }

  stop() {
    this.sub?.unsubscribe();
    this.sub = null;
  }

  private async tick() {
    for (const pos of this.positions.all()) {
      try {
        const priceSOL = await this.prices.getPrice(pos.ca);
        if (!priceSOL || priceSOL <= 0) continue;

        this.executor.updatePrice(pos.ca, priceSOL);

        const exit = evaluateExit(pos.entryPriceSOL, priceSOL, pos.peakPriceSOL, pos.openedAt);
        if (exit.shouldExit) {
          console.log(`[PriceTracker] ${pos.token}: ${exit.reason} at ${priceSOL} SOL`);
          await this.executor.sell(pos.ca, exit.reason);
        }
      } catch (err) {
        console.error(`[PriceTracker] Error checking ${pos.token}:`, err);
      }
    }
  }
}
