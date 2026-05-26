import { homedir } from "node:os";
import { resolve } from "node:path";

export interface StashBoxConfig {
  enabled: boolean;
  apiKey: string;
  endpoint: string;
}

export interface JavdbConfig {
  enabled: boolean;
  baseUrl: string;
}

export interface CacheConfig {
  diskDir: string | null;
  ttlSeconds: number;
  maxItems: number;
}

export interface AppConfig {
  javstash: StashBoxConfig;
  pmvstash: StashBoxConfig;
  javdb: JavdbConfig;
  cache: CacheConfig;
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function bool(name: string, def: boolean): boolean {
  const raw = (process.env[name] || "").toLowerCase().trim();
  if (raw === "") return def;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export function loadConfig(): AppConfig {
  const javstashKey = process.env.JAVSTASH_API_KEY?.trim() || "";
  const pmvstashKey = process.env.PMVSTASH_API_KEY?.trim() || "";

  const diskDirRaw = process.env.CACHE_DIR;
  const diskDir =
    diskDirRaw === undefined
      ? expandHome("~/.cache/movie-db-mcp")
      : diskDirRaw.trim() === ""
        ? null
        : expandHome(diskDirRaw);

  return {
    javstash: {
      enabled: javstashKey.length > 0,
      apiKey: javstashKey,
      endpoint: process.env.JAVSTASH_ENDPOINT?.trim() || "https://javstash.org/graphql",
    },
    pmvstash: {
      enabled: pmvstashKey.length > 0,
      apiKey: pmvstashKey,
      endpoint: process.env.PMVSTASH_ENDPOINT?.trim() || "https://pmvstash.org/graphql",
    },
    javdb: {
      enabled: bool("JAVDB_ENABLED", false),
      baseUrl: process.env.JAVDB_BASE_URL?.trim() || "https://javdb.com",
    },
    cache: {
      diskDir,
      ttlSeconds: num("CACHE_TTL_SECONDS", 3600),
      maxItems: num("CACHE_MAX_ITEMS", 500),
    },
  };
}
