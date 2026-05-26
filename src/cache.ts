import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LRUCache } from "lru-cache";
import type { CacheConfig } from "./config.js";
import { logger } from "./logger.js";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class Cache {
  private readonly memory: LRUCache<string, Entry<unknown>>;
  private readonly diskDir: string | null;
  private readonly ttlMs: number;
  private diskReady: Promise<void> | null = null;

  constructor(cfg: CacheConfig) {
    this.memory = new LRUCache({ max: cfg.maxItems });
    this.diskDir = cfg.diskDir;
    this.ttlMs = cfg.ttlSeconds * 1000;
  }

  static key(namespace: string, parts: unknown): string {
    const json = JSON.stringify(parts);
    const hash = createHash("sha256").update(json).digest("hex").slice(0, 32);
    return `${namespace}:${hash}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const now = Date.now();
    const mem = this.memory.get(key) as Entry<T> | undefined;
    if (mem && mem.expiresAt > now) return mem.value;
    if (mem) this.memory.delete(key);

    if (!this.diskDir) return undefined;
    try {
      await this.ensureDiskDir();
      const path = this.diskPath(key);
      const raw = await readFile(path, "utf8");
      const entry = JSON.parse(raw) as Entry<T>;
      if (entry.expiresAt <= now) return undefined;
      this.memory.set(key, entry as Entry<unknown>);
      return entry.value;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") logger.debug("cache disk read failed", { key, err: String(err) });
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const entry: Entry<T> = { value, expiresAt: Date.now() + this.ttlMs };
    this.memory.set(key, entry as Entry<unknown>);
    if (!this.diskDir) return;
    try {
      await this.ensureDiskDir();
      await writeFile(this.diskPath(key), JSON.stringify(entry), "utf8");
    } catch (err) {
      logger.debug("cache disk write failed", { key, err: String(err) });
    }
  }

  async wrap<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      logger.debug("cache hit", { key });
      return cached;
    }
    logger.debug("cache miss", { key });
    const fresh = await fetcher();
    await this.set(key, fresh);
    return fresh;
  }

  private diskPath(key: string): string {
    return join(this.diskDir!, key.replace(/[:/]/g, "_") + ".json");
  }

  private ensureDiskDir(): Promise<void> {
    if (!this.diskDir) return Promise.resolve();
    if (!this.diskReady) {
      this.diskReady = mkdir(this.diskDir, { recursive: true }).then(() => undefined);
    }
    return this.diskReady;
  }
}
