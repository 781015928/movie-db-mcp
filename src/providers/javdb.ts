import { spawn } from "node:child_process";
import * as cheerio from "cheerio";
import { Cache } from "../cache.js";
import type { JavdbConfig } from "../config.js";
import { logger } from "../logger.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * javdb sits behind Cloudflare, which matches Node's TLS fingerprint as a bot
 * and returns 403 even with browser-like headers. The system `curl` binary
 * produces a different TLS handshake and gets through. We try fetch first
 * (lighter), then fall back to curl on 403/blocked.
 */
async function fetchWithCurl(url: string, ua: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--max-time",
      "20",
      "--http2",
      "-A",
      ua,
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
      "-w",
      "\n__HTTP_STATUS__:%{http_code}",
      url,
    ];
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", (e) => reject(new Error(`curl spawn failed: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `curl exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 200)}`,
          ),
        );
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const match = body.match(/\n__HTTP_STATUS__:(\d+)$/);
      const status = match ? parseInt(match[1], 10) : 0;
      const html = match ? body.slice(0, match.index) : body;
      if (status < 200 || status >= 400) {
        return reject(new Error(`javdb HTTP ${status} for ${url}`));
      }
      resolve(html);
    });
  });
}

export interface JavdbSummary {
  source: "javdb";
  id: string;
  code: string | null;
  title: string | null;
  thumbnail: string | null;
  detailPath: string;
}

export interface JavdbDetail extends JavdbSummary {
  originTitle: string | null;
  date: string | null;
  duration: number | null;
  director: string | null;
  studio: string | null;
  series: string | null;
  rating: string | null;
  tags: string[];
  performers: string[];
  cover: string | null;
}

export class JavdbClient {
  private readonly baseUrl: string;
  private readonly cache: Cache;

  constructor(cfg: JavdbConfig, cache: Cache) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.cache = cache;
  }

  async searchByCode(code: string): Promise<JavdbSummary[]> {
    const key = Cache.key("javdb:search", { code });
    return this.cache.wrap(key, async () => {
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(code)}&f=all`;
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);
      const results: JavdbSummary[] = [];
      $(".movie-list .item").each((_, el) => {
        const $box = $(el).find("a.box").first();
        const href = $box.attr("href") || "";
        if (!href.startsWith("/v/")) return;
        const id = href.slice(3);
        const fullTitle = $box.attr("title") || null;
        const titleEl = $box.find(".video-title").first();
        const codeText = titleEl.find("strong").first().text().trim() || null;
        const titleClone = titleEl.clone();
        titleClone.find("strong").remove();
        const title = titleClone.text().trim() || fullTitle;
        const img = $box.find(".cover img").attr("src") || null;
        results.push({
          source: "javdb",
          id,
          code: codeText,
          title,
          thumbnail: img,
          detailPath: href,
        });
      });
      logger.debug("javdb search", { code, found: results.length });
      return results;
    });
  }

  async getDetail(id: string): Promise<JavdbDetail | null> {
    const key = Cache.key("javdb:detail", { id });
    return this.cache.wrap(key, async () => {
      const url = `${this.baseUrl}/v/${encodeURIComponent(id)}`;
      const html = await this.fetchHtml(url);
      if (!html) return null;
      const $ = cheerio.load(html);
      const title = $("h2.title strong.current-title").first().text().trim() || null;
      const originTitle = $("h2.title span.origin-title").first().text().trim() || null;
      const cover = $("img.video-cover").attr("src") || null;
      const panel = $(".movie-panel-info");

      const fields: Record<string, cheerio.Cheerio<any>> = {};
      panel.find(".panel-block").each((_, el) => {
        const $el = $(el);
        const label = $el.find("strong").first().text().trim().replace(/[:：]/g, "");
        const value = $el.find("span.value").first();
        if (label && value.length) fields[label] = value;
      });
      const text = (label: string) => fields[label]?.text().trim() || null;
      const links = (label: string) =>
        (fields[label]?.find("a").toArray() ?? []).map((a) => $(a).text().trim()).filter(Boolean);

      const code = text("番號") || text("番号");
      const date = text("日期");
      const durRaw = text("時長") || text("时长");
      const duration = durRaw ? parseInt(durRaw.replace(/[^0-9]/g, ""), 10) || null : null;
      const director = text("導演") || text("导演");
      const studioLinks = links("片商");
      const seriesLinks = links("系列");
      const tagLinks = links("類別") || links("类别");
      const performerLinks = links("演員") || links("演员");
      const rating = text("評分") || text("评分");

      return {
        source: "javdb",
        id,
        code,
        title: title || originTitle,
        originTitle,
        thumbnail: cover,
        detailPath: `/v/${id}`,
        date,
        duration,
        director,
        studio: studioLinks[0] || null,
        series: seriesLinks[0] || null,
        rating,
        tags: tagLinks,
        performers: performerLinks,
        cover,
      };
    });
  }

  private async fetchHtml(url: string): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      });
      if (res.ok) return await res.text();
      if (res.status === 403 || res.status === 503) {
        logger.debug("javdb fetch blocked, falling back to curl", { url, status: res.status });
        return await fetchWithCurl(url, UA);
      }
      throw new Error(`javdb HTTP ${res.status} for ${url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("HTTP 4") || msg.includes("HTTP 5")) throw err;
      logger.debug("javdb fetch errored, trying curl", { url, err: msg });
      return await fetchWithCurl(url, UA);
    }
  }
}
