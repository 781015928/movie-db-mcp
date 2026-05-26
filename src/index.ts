#!/usr/bin/env node
import { startServer, PKG_NAME, PKG_VERSION } from "./server.js";
import { logger } from "./logger.js";

function printHelp(): void {
  const help = `${PKG_NAME} ${PKG_VERSION}

MCP server providing movie metadata (JAV via javstash/javdb, PMV via pmvstash).

USAGE
  npx ${PKG_NAME}              start MCP server on stdio
  npx ${PKG_NAME} --help       show this help
  npx ${PKG_NAME} --version    print version

ENABLE PROVIDERS (env vars)
  JAVSTASH_API_KEY=<jwt>       enable JAV search via javstash GraphQL
  PMVSTASH_API_KEY=<jwt>       enable PMV search via pmvstash GraphQL
  JAVDB_ENABLED=true           enable javdb HTML fallback (no key needed)

CACHE (defaults shown)
  CACHE_DIR=~/.cache/movie-db-mcp   disk cache dir (empty string disables disk)
  CACHE_TTL_SECONDS=3600
  CACHE_MAX_ITEMS=500

CLAUDE DESKTOP CONFIG EXAMPLE
  {
    "mcpServers": {
      "movie-db": {
        "command": "npx",
        "args": ["-y", "${PKG_NAME}"],
        "env": {
          "JAVSTASH_API_KEY": "...",
          "PMVSTASH_API_KEY": "...",
          "JAVDB_ENABLED": "true"
        }
      }
    }
  }
`;
  process.stdout.write(help);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${PKG_VERSION}\n`);
    return;
  }
  await startServer();
}

main().catch((err) => {
  logger.error("fatal", { err: err instanceof Error ? err.message : String(err) });
  if (err instanceof Error && err.stack) logger.debug("stack", { stack: err.stack });
  process.exit(1);
});
