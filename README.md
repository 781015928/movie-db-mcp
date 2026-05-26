# movie-db-mcp

MCP server providing movie metadata from three sources:

- **javstash** — JAV scenes via the open Stash-Box GraphQL API at `javstash.org`
- **pmvstash** — PMV scenes via the open Stash-Box GraphQL API at `pmvstash.org`
- **javdb** — JAV HTML scraper used as a fallback when javstash returns no result for a JAV code

Each provider is opt-in via env vars. Results are cached in a two-layer cache (in-memory LRU + disk JSON) so repeated lookups are instant.

## Install / use via npx

No install required:

```bash
npx -y movie-db-mcp
```

This starts an MCP server on stdio. Configure your MCP client to launch it.

### Claude Desktop / Claude Code

Add to your MCP config (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "movie-db": {
      "command": "npx",
      "args": ["-y", "movie-db-mcp"],
      "env": {
        "JAVSTASH_API_KEY": "your-javstash-jwt-here",
        "PMVSTASH_API_KEY": "your-pmvstash-jwt-here",
        "JAVDB_ENABLED": "true"
      }
    }
  }
}
```

Restart your MCP client. Tools will appear: `jav_search`, `jav_get_scene`, `jav_get_scene_javdb`, `pmv_search`, `pmv_get_scene`. Only the tools whose providers are enabled show up.

## Configuration

All configuration is via environment variables. A `.env.example` ships with the package.

### Provider toggles

| Env var | Effect |
|---------|--------|
| `JAVSTASH_API_KEY` | Set to your JWT from javstash.org to enable JAV search via javstash. |
| `JAVSTASH_ENDPOINT` | Override the GraphQL endpoint. Default: `https://javstash.org/graphql`. |
| `PMVSTASH_API_KEY` | Set to your JWT from pmvstash.org to enable PMV search via pmvstash. |
| `PMVSTASH_ENDPOINT` | Override the GraphQL endpoint. Default: `https://pmvstash.org/graphql`. |
| `JAVDB_ENABLED` | Set to `true` to enable the javdb HTML fallback. No key needed. |
| `JAVDB_BASE_URL` | Override the javdb base URL. Default: `https://javdb.com`. |

At least one provider must be enabled or the server exits with an error.

### Cache

| Env var | Default | Meaning |
|---------|---------|---------|
| `CACHE_DIR` | `~/.cache/movie-db-mcp` | Disk cache dir. Set to empty string to disable disk layer. |
| `CACHE_TTL_SECONDS` | `3600` | TTL for cached responses. |
| `CACHE_MAX_ITEMS` | `500` | Max items in the in-memory LRU. |

The cache key is `sha256(namespace + args)`, so different queries are independent.

### Logging

| Env var | Default | Meaning |
|---------|---------|---------|
| `LOG_LEVEL` | `info` | One of `silent`, `error`, `warn`, `info`, `debug`. Logs go to stderr (stdout is reserved for the MCP protocol). |

## Tools

All tools return JSON-encoded text content (one block).

### `jav_search`
Search JAV scenes by code or free text.
- Args: `query` (string, required), `limit` (int 1-40, default 10)
- Behaviour: queries javstash first; if `query` looks like a JAV code (e.g. `SSIS-001`) and javstash returns nothing, falls back to javdb when enabled.
- Returns: `{ source, count, results: [{ source, id, code, title, date, studio, performers, thumbnail }] }`

### `jav_get_scene`
Fetch full JAV scene metadata from javstash by UUID.
- Args: `id` (UUID string)
- Returns: full scene with title, code, release date, duration, studio, performers, tags, images, URLs, and details.

### `jav_get_scene_javdb`
Fetch JAV detail from javdb by short id (e.g. `ZY5eq`). Use this when `jav_search` returned a result with `source: "javdb"`.
- Args: `id` (string)
- Returns: title (translated + original), code, date, duration, director, studio, series, rating, tags, performers, cover.

### `pmv_search`
Search PMV scenes by free text on pmvstash.
- Args: `query` (string, required), `limit` (int 1-40, default 10)
- Returns: `{ source, count, results: [{ source, id, title, date, studio, performers, thumbnail }] }`

### `pmv_get_scene`
Fetch full PMV scene metadata from pmvstash by UUID.
- Args: `id` (UUID string)
- Returns: full scene details (same shape as `jav_get_scene`).

## Notes

- **javdb sits behind Cloudflare.** Node's native `fetch` is fingerprinted as a bot and returns 403. The scraper falls back to the system `curl` binary, which gets through. macOS, Linux, and Windows 10+ all ship with curl.
- **JAV code lookup uses fuzzy matching.** `searchScene` is a full-text search; the client filters results client-side so partial matches like `SSIS-001` → `SSIS001` work.
- **The two stash-box APIs share a schema.** javstash and pmvstash are both deployments of the open-source [stashapp/stash-box](https://github.com/stashapp/stash-box) registry, so the same GraphQL client (`StashBoxClient`) drives both.

## Development

```bash
git clone https://github.com/781015928/movie-db-mcp.git
cd movie-db-mcp
npm install
cp .env.example .env       # then fill in your keys
npm run build              # tsc → dist/
npm start                  # start the MCP server on stdio
npm run dev                # tsx watch mode
```

## Publishing

Pushing a tag `v*` (e.g. `v0.1.0`) triggers `.github/workflows/publish.yml`, which runs `release:check` and publishes to npm using the `NPM_TOKEN` repo secret.

```bash
# bump version, commit, tag, push
npm version patch -m "release v%s"
git push --follow-tags
```

## License

MIT © Kent Grote
