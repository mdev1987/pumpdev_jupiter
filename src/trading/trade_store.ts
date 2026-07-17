import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { TradeRecord } from "../types";

export class TradeStore {
  private db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        ca TEXT NOT NULL,
        dex TEXT,
        side TEXT NOT NULL,
        amountSol REAL NOT NULL,
        price REAL NOT NULL,
        pnl REAL,
        reason TEXT,
        balance REAL NOT NULL,
        createdAt INTEGER NOT NULL
      )
    `);
  }

  insert(record: Omit<TradeRecord, "id">) {
    const stmt = this.db.prepare(
      `INSERT INTO trades (token, ca, dex, side, amountSol, price, pnl, reason, balance, createdAt)
       VALUES ($token, $ca, $dex, $side, $amountSol, $price, $pnl, $reason, $balance, $createdAt)`,
    );
    stmt.run({
      $token: record.token,
      $ca: record.ca,
      $dex: record.dex ?? null,
      $side: record.side,
      $amountSol: record.amountSol,
      $price: record.price,
      $pnl: record.pnl ?? null,
      $reason: record.reason ?? null,
      $balance: record.balance,
      $createdAt: record.createdAt,
    });
  }

  all(): TradeRecord[] {
    return this.db.query("SELECT * FROM trades ORDER BY createdAt ASC").all() as TradeRecord[];
  }

  recent(limit: number = 20): TradeRecord[] {
    return this.db
      .query("SELECT * FROM trades ORDER BY id DESC LIMIT $limit")
      .all({ $limit: limit }) as TradeRecord[];
  }

  stats() {
    const row = this.db
      .query(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) as buys,
           SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sells,
           AVG(CASE WHEN pnl IS NOT NULL THEN pnl ELSE NULL END) as avgPnl,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses
         FROM trades`,
      )
      .get() as { total: number; buys: number; sells: number; avgPnl: number | null; wins: number; losses: number } | undefined;

    if (!row) return { total: 0, buys: 0, sells: 0, avgPnl: null, winRate: null };

    const closed = row.wins + row.losses;
    return {
      total: row.total,
      buys: row.buys,
      sells: row.sells,
      avgPnl: row.avgPnl,
      winRate: closed > 0 ? row.wins / closed : null,
    };
  }

  close() {
    this.db.close();
  }
}
