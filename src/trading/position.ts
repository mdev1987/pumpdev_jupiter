import type { Position } from "../types";

export class PositionManager {
  private positions = new Map<string, Position>();

  add(p: Position) {
    this.positions.set(p.ca, p);
  }

  get(ca: string) {
    return this.positions.get(ca);
  }

  remove(ca: string) {
    this.positions.delete(ca);
  }

  all() {
    return [...this.positions.values()];
  }

  count() {
    return this.positions.size;
  }
}
