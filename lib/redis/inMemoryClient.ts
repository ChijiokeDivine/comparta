// lib/redis/inMemoryClient.ts
//
// Minimal in-process stand-in for IORedis, used when REDIS_DISABLED is on
// (typically local development without a Redis server running).
//
// It implements only the handful of commands this codebase actually issues
// directly - get/set/del/incr/expire/ttl - plus no-op publish/subscribe so
// lib/realtime/eventBus.ts keeps doing its same-process EventEmitter fan-out.
//
// State is per-process and lost on restart: cache entries and rate-limit
// counters are NOT shared across instances. That's the intended trade-off for
// single-process local dev, never for production.

import { EventEmitter } from "node:events";

type Entry = { value: string; expiresAt: number | null };

export class InMemoryRedis extends EventEmitter {
  private readonly store: Map<string, Entry>;

  constructor(store?: Map<string, Entry>) {
    super();
    this.store = store ?? new Map();
    this.setMaxListeners(1000);
  }

  get status(): string {
    return "ready";
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string | number, ...args: unknown[]): Promise<"OK"> {
    let expiresAt: number | null = null;
    for (let i = 0; i < args.length; i++) {
      const token = String(args[i]).toUpperCase();
      if ((token === "EX" || token === "PX") && args[i + 1] !== undefined) {
        const amount = Number(args[i + 1]);
        if (Number.isFinite(amount)) {
          expiresAt = Date.now() + (token === "EX" ? amount * 1000 : amount);
        }
        i++;
      }
    }
    this.store.set(key, { value: String(value), expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    // Like Redis, INCR keeps any existing TTL on the key.
    const existing = this.live(key);
    const next = Number(existing?.value ?? "0") + 1;
    if (!Number.isFinite(next)) {
      throw new Error("ERR value is not an integer or out of range");
    }
    this.store.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  // No cross-process bus to talk to - eventBus.ts already emits on its local
  // EventEmitter before calling publish, so returning 0 receivers is correct.
  async publish(): Promise<number> {
    return 0;
  }

  async subscribe(...channels: string[]): Promise<number> {
    return channels.length;
  }

  async unsubscribe(...channels: string[]): Promise<number> {
    return channels.length;
  }

  /** Same data, independent listeners - mirrors IORedis#duplicate. */
  duplicate(): InMemoryRedis {
    return new InMemoryRedis(this.store);
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }

  disconnect(): void {
    // nothing to tear down
  }
}
