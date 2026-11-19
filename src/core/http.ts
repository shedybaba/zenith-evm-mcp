import { VERSION } from "../version.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

const USER_AGENT = `zenith-evm-mcp/${VERSION}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function buildUrl(base: string, query?: FetchJsonOptions["query"]): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Fetch JSON with a timeout and polite retries on 429/503 (honouring Retry-After). */
export async function fetchJson<T = unknown>(
  base: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const url = buildUrl(base, opts.query);
  const retries = opts.retries ?? 2;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": USER_AGENT };
  let body: string | undefined;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
    } catch (err) {
      // Network-level failure: retry with a short backoff, then report clearly.
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new HttpError(
        `Could not reach ${new URL(url).host}: ${(err as Error).message}`,
        0,
        url,
        null,
      );
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text.length ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (for example an HTML error page); keep the raw text.
    }
    if (res.ok) return parsed as T;

    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000,
      );
      continue;
    }
    const detail =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : typeof parsed === "string"
          ? parsed.slice(0, 200)
          : res.statusText;
    throw new HttpError(`HTTP ${res.status} from ${url}: ${detail}`, res.status, url, parsed);
  }
}
