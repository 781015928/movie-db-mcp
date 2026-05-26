import type { Cache } from "../cache.js";
import { Cache as CacheNs } from "../cache.js";
import type { StashBoxConfig } from "../config.js";
import { logger } from "../logger.js";

export interface SceneSummary {
  id: string;
  title: string | null;
  code: string | null;
  date: string | null;
  duration: number | null;
  studio: { id: string; name: string } | null;
  performers: { id: string; name: string; as: string | null }[];
  thumbnail: string | null;
  urls: string[];
}

export interface SceneDetail extends SceneSummary {
  details: string | null;
  director: string | null;
  productionDate: string | null;
  tags: { id: string; name: string }[];
  images: { url: string; width: number | null; height: number | null }[];
  sites: { name: string | null; url: string | null }[];
}

interface SceneNode {
  id: string;
  title: string | null;
  code: string | null;
  release_date: string | null;
  production_date?: string | null;
  duration: number | null;
  details?: string | null;
  director?: string | null;
  urls: { url: string; site: { name: string | null; url: string | null } | null }[];
  studio: { id: string; name: string } | null;
  performers: { performer: { id: string; name: string } | null; as: string | null }[];
  tags?: { id: string; name: string }[];
  images: { url: string; width: number | null; height: number | null }[];
}

const SCENE_FIELDS_SUMMARY = `
  id
  title
  code
  release_date
  duration
  urls { url site { name url } }
  studio { id name }
  performers { performer { id name } as }
  images { url width height }
`;

const SCENE_FIELDS_DETAIL = `
  id
  title
  code
  release_date
  production_date
  duration
  details
  director
  urls { url site { name url } }
  studio { id name }
  performers { performer { id name } as }
  tags { id name }
  images { url width height }
`;

export class StashBoxClient {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly cache: Cache;

  constructor(name: string, cfg: StashBoxConfig, cache: Cache) {
    this.name = name;
    this.endpoint = cfg.endpoint;
    this.apiKey = cfg.apiKey;
    this.cache = cache;
  }

  async searchScenes(term: string, limit: number): Promise<SceneSummary[]> {
    const key = CacheNs.key(`${this.name}:searchScenes`, { term, limit });
    return this.cache.wrap(key, async () => {
      const data = await this.gql<{ searchScene: SceneNode[] }>(
        `query SearchScene($term: String!, $limit: Int) {
           searchScene(term: $term, limit: $limit) { ${SCENE_FIELDS_SUMMARY} }
         }`,
        { term, limit },
      );
      return data.searchScene.map(toSummary);
    });
  }

  async queryScenes(input: {
    text?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ count: number; scenes: SceneSummary[] }> {
    const key = CacheNs.key(`${this.name}:queryScenes`, input);
    return this.cache.wrap(key, async () => {
      const data = await this.gql<{
        queryScenes: { count: number; scenes: SceneNode[] };
      }>(
        `query QueryScenes($input: SceneQueryInput!) {
           queryScenes(input: $input) {
             count
             scenes { ${SCENE_FIELDS_SUMMARY} }
           }
         }`,
        { input },
      );
      return {
        count: data.queryScenes.count,
        scenes: data.queryScenes.scenes.map(toSummary),
      };
    });
  }

  async findScene(id: string): Promise<SceneDetail | null> {
    const key = CacheNs.key(`${this.name}:findScene`, { id });
    return this.cache.wrap(key, async () => {
      const data = await this.gql<{ findScene: SceneNode | null }>(
        `query FindScene($id: ID!) {
           findScene(id: $id) { ${SCENE_FIELDS_DETAIL} }
         }`,
        { id },
      );
      return data.findScene ? toDetail(data.findScene) : null;
    });
  }

  /** Look up by JAV code: try searchScene first (fuzzy), then verify code matches. */
  async findByCode(code: string): Promise<SceneSummary[]> {
    const results = await this.searchScenes(code, 10);
    const normalized = code.toLowerCase().replace(/[-_\s]/g, "");
    return results.filter((s) => {
      if (!s.code) return false;
      const c = s.code.toLowerCase().replace(/[-_\s]/g, "");
      return c === normalized || c.includes(normalized) || normalized.includes(c);
    });
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${this.name} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      logger.error(`${this.name} GraphQL errors`, { query: query.slice(0, 80), msg });
      throw new Error(`${this.name} GraphQL: ${msg}`);
    }
    if (!json.data) throw new Error(`${this.name} returned no data`);
    return json.data;
  }
}

function toSummary(n: SceneNode): SceneSummary {
  const performers = n.performers
    .filter((p) => p.performer)
    .map((p) => ({ id: p.performer!.id, name: p.performer!.name, as: p.as }));
  const thumbnail = n.images[0]?.url ?? null;
  return {
    id: n.id,
    title: n.title,
    code: n.code,
    date: n.release_date,
    duration: n.duration,
    studio: n.studio,
    performers,
    thumbnail,
    urls: n.urls.map((u) => u.url),
  };
}

function toDetail(n: SceneNode): SceneDetail {
  return {
    ...toSummary(n),
    details: n.details ?? null,
    director: n.director ?? null,
    productionDate: n.production_date ?? null,
    tags: n.tags ?? [],
    images: n.images.map((i) => ({ url: i.url, width: i.width, height: i.height })),
    sites: n.urls.map((u) => ({
      name: u.site?.name ?? null,
      url: u.site?.url ?? null,
    })),
  };
}
