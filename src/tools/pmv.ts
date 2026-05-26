import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StashBoxClient } from "../providers/stashbox.js";
import { logger } from "../logger.js";

interface Deps {
  pmvstash: StashBoxClient;
}

export function registerPmvTools(server: McpServer, deps: Deps): number {
  let count = 0;

  server.registerTool(
    "pmv_search",
    {
      description:
        "Search PMV (Porn Music Video) scenes by free-text on pmvstash. " +
        "Returns a compact list of matching scenes with id, title, date, studio, performers, and thumbnail.",
      inputSchema: {
        query: z.string().min(1).describe("free-text search term"),
        limit: z.number().int().min(1).max(40).default(10).describe("max results"),
      },
    },
    async ({ query, limit }) => {
      const trimmed = query.trim();
      logger.info("pmv_search", { query: trimmed, limit });
      const hits = await deps.pmvstash.searchScenes(trimmed, limit);
      const results = hits.slice(0, limit).map((s) => ({
        source: "pmvstash",
        id: s.id,
        title: s.title,
        date: s.date,
        studio: s.studio?.name ?? null,
        performers: s.performers.map((p) => p.name),
        thumbnail: s.thumbnail,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ source: "pmvstash", count: results.length, results }, null, 2),
          },
        ],
      };
    },
  );
  count++;

  server.registerTool(
    "pmv_get_scene",
    {
      description:
        "Fetch full PMV scene metadata from pmvstash by its stash-box id (UUID). " +
        "Returns title, release date, duration, studio, performers, tags, images, urls, and details.",
      inputSchema: {
        id: z.string().min(1).describe("pmvstash scene id (UUID returned by pmv_search)"),
      },
    },
    async ({ id }) => {
      const scene = await deps.pmvstash.findScene(id);
      if (!scene) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "not found", id }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(scene, null, 2) }] };
    },
  );
  count++;

  return count;
}
