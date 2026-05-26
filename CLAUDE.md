# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                # install deps
npm run build              # tsc → dist/ (runs prebuild clean)
npm run typecheck          # type check only, no emit
npm start                  # node dist/index.js (run the MCP server on stdio)
npm run dev                # tsx watch src/index.ts
npm run release:check      # typecheck + build (gate for publish)
```

There are no unit tests yet. End-to-end smoke testing is done by running the MCP server with stdio and exchanging JSON-RPC messages — see the test scripts under `/tmp` after running them locally, or model new ones on the pattern: spawn `node dist/index.js` with env vars, write `initialize` → `tools/list` → `tools/call` to stdin, parse JSON line responses from stdout.

## Architecture

This is an MCP (Model Context Protocol) server that exposes movie metadata tools to AI clients over stdio. The entry point is `dist/index.js` (built from `src/index.ts`), declared in `package.json#bin` so it can be launched with `npx`.

### Provider layer (`src/providers/`)

Three providers, each opt-in via env vars:

- **`stashbox.ts`** — single GraphQL client that drives both `javstash.org` and `pmvstash.org`. The two sites are both deployments of the open-source [stashapp/stash-box](https://github.com/stashapp/stash-box) registry, so they share an identical schema (`searchScene`, `queryScenes`, `findScene`, etc., with `ApiKey:` JWT header auth). One class, two instances configured differently. Returns shaped `SceneSummary` / `SceneDetail` types defined in this file.
- **`javdb.ts`** — HTML scraper for `javdb.com`. Used only as a fallback when javstash returns no result for a JAV code lookup. **Important:** javdb sits behind Cloudflare and Node's native `fetch` is TLS-fingerprinted as a bot (returns 403 even with browser UA). The scraper tries `fetch` first, and on 403/503 falls back to spawning `curl` as a subprocess — system curl uses a different TLS handshake and gets through. macOS/Linux/Win10+ all ship with curl.

### Cache (`src/cache.ts`)

Two-layer: in-memory `LRUCache` + on-disk JSON files. Keys are `sha256(JSON.stringify(args)).slice(0, 32)`, namespaced by provider+method (e.g. `javstash:searchScenes:<hash>`). Empty results are cached too, so a known-empty lookup doesn't re-fetch. Read flow: memory → disk → fetcher; writes go to both layers. Disk dir is configurable via `CACHE_DIR` (`~` expansion supported); set to empty string to disable disk layer.

### Tool registration (`src/tools/`)

Tools are registered conditionally based on which providers are enabled. `jav.ts` and `pmv.ts` each export a `registerJavTools` / `registerPmvTools` function that receives the configured client(s) and returns a count of registered tools. `server.ts` wires this up at startup and exits with a clear error if zero providers are configured.

### JAV code fallback flow

`jav_search` is the only tool that touches two providers. The flow is:
1. Detect if `query` looks like a JAV code via regex `/^[A-Za-z]{2,6}-?\d{2,5}$/`.
2. Always query javstash first (when enabled).
3. If `isCode && results.length === 0 && javdb is enabled`, additionally try javdb.
4. Annotate the response `source` field as `"javstash"`, `"javdb"`, or `"javstash+javdb"` so callers can tell where each result came from.

### Logging

`src/logger.ts` writes to **stderr** because stdout is reserved for the MCP JSON-RPC protocol — never `console.log` anywhere in the runtime path. `LOG_LEVEL` env var controls verbosity.

## Configuration

All configuration via env vars. See `.env.example`. The key principle: providers are gated by the *presence* of their API key (or `JAVDB_ENABLED=true`), not a separate enable flag. So setting only `PMVSTASH_API_KEY` gives you pmv tools only.

## Publishing

`.github/workflows/publish.yml` triggers on `v*` tags or manual dispatch. It runs `release:check` (typecheck + build) then `npm publish --provenance --access public` using the `NPM_TOKEN` repo secret. Provenance works because the repo is public — Sigstore cross-checks the npm publish event against the GitHub Actions OIDC token, and the package page on npmjs.com will display a verified source-link badge. The `prepublishOnly` script in `package.json` also runs `release:check` as a local safety net.

`.npmignore` strips `src/`, `tsconfig.json`, workflows, and tests from the published tarball — only `dist/`, `README.md`, `LICENSE`, and `.env.example` ship.
