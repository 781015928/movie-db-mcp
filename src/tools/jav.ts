import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JavdbClient } from "../providers/javdb.js";
import type { StashBoxClient } from "../providers/stashbox.js";
import { logger } from "../logger.js";

const JAV_CODE_RE = /^[A-Za-z]{2,6}-?\d{2,5}$/;

function looksLikeCode(s: string): boolean {
  return JAV_CODE_RE.test(s.trim());
}

interface Deps {
  javstash: StashBoxClient | null;
  javdb: JavdbClient | null;
}

export function registerJavTools(server: McpServer, deps: Deps): number {
  if (!deps.javstash && !deps.javdb) return 0;
  let count = 0;

  server.registerTool(
    "jav_search",
    {
      description:
        "Search JAV (Japanese Adult Video) scenes by code (e.g. 'SSIS-001') or free-text. " +
        "Queries javstash first; if a JAV code yields no results, falls back to javdb (when enabled). " +
        "Returns a compact list of matching scenes with id, code, title, studio, performers, and thumbnail.",
      inputSchema: {
        query: z.string().min(1).describe("JAV code (e.g. 'SSIS-001') or keyword"),
        limit: z.number().int().min(1).max(40).default(10).describe("max results"),
      },
    },
    async ({ query, limit }) => {
      const trimmed = query.trim();
      const isCode = looksLikeCode(trimmed);
      logger.info("jav_search", { query: trimmed, isCode, limit });

      const out: Array<Record<string, unknown>> = [];
      let source: "javstash" | "javdb" | "javstash+javdb" = "javstash";

      if (deps.javstash) {
        const hits = isCode
          ? await deps.javstash.findByCode(trimmed)
          : await deps.javstash.searchScenes(trimmed, limit);
        for (const s of hits.slice(0, limit)) {
          out.push({
            source: "javstash",
            id: s.id,
            code: s.code,
            title: s.title,
            date: s.date,
            studio: s.studio?.name ?? null,
            performers: s.performers.map((p) => p.name),
            thumbnail: s.thumbnail,
          });
        }
      }

      if (out.length === 0 && isCode && deps.javdb) {
        source = deps.javstash ? "javstash+javdb" : "javdb";
        const hits = await deps.javdb.searchByCode(trimmed);
        for (const s of hits.slice(0, limit)) {
          out.push({
            source: "javdb",
            id: s.id,
            code: s.code,
            title: s.title,
            thumbnail: s.thumbnail,
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ source, count: out.length, results: out }, null, 2),
          },
        ],
      };
    },
  );
  count++;

  if (deps.javstash) {
    server.registerTool(
      "jav_get_scene",
      {
        description:
          "Fetch full JAV scene metadata from javstash by its stash-box id (UUID). " +
          "Returns title, code, release date, duration, studio, performers, tags, images, urls, and details.",
        inputSchema: {
          id: z.string().min(1).describe("javstash scene id (UUID returned by jav_search)"),
        },
      },
      async ({ id }) => {
        const scene = await deps.javstash!.findScene(id);
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
  }

  if (deps.javdb) {
    server.registerTool(
      "jav_get_scene_javdb",
      {
        description:
          "Fetch JAV scene detail from javdb (HTML scraped) by javdb short id (e.g. 'ZY5eq'). " +
          "Use this when jav_search returned a result with source='javdb'.",
        inputSchema: {
          id: z.string().min(1).describe("javdb short id (the path segment after /v/)"),
        },
      },
      async ({ id }) => {
        const scene = await deps.javdb!.getDetail(id);
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
  }

  return count;
}
