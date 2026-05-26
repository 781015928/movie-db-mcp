import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Cache } from "./cache.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { JavdbClient } from "./providers/javdb.js";
import { StashBoxClient } from "./providers/stashbox.js";
import { registerJavTools } from "./tools/jav.js";
import { registerPmvTools } from "./tools/pmv.js";

export const PKG_NAME = "movie-db-mcp";
export const PKG_VERSION = "0.1.0";

export async function startServer(): Promise<void> {
  const cfg = loadConfig();
  const cache = new Cache(cfg.cache);

  const enabled: string[] = [];
  if (cfg.javstash.enabled) enabled.push("javstash");
  if (cfg.pmvstash.enabled) enabled.push("pmvstash");
  if (cfg.javdb.enabled) enabled.push("javdb");

  if (enabled.length === 0) {
    logger.error(
      "No providers enabled. Set JAVSTASH_API_KEY, PMVSTASH_API_KEY, or JAVDB_ENABLED=true.",
    );
    process.exit(1);
  }
  logger.info("starting", { providers: enabled, version: PKG_VERSION });

  const javstash = cfg.javstash.enabled
    ? new StashBoxClient("javstash", cfg.javstash, cache)
    : null;
  const pmvstash = cfg.pmvstash.enabled
    ? new StashBoxClient("pmvstash", cfg.pmvstash, cache)
    : null;
  const javdb = cfg.javdb.enabled ? new JavdbClient(cfg.javdb, cache) : null;

  const server = new McpServer({ name: PKG_NAME, version: PKG_VERSION });

  let total = 0;
  total += registerJavTools(server, { javstash, javdb });
  if (pmvstash) total += registerPmvTools(server, { pmvstash });
  logger.info("tools registered", { count: total });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("connected to stdio transport");
}
