import { ensurePartySchema, getD1 } from ".";

const RETENTION_DAYS = 90;
const REPORT_DAYS = 30;

type AnalyticsInput = {
  path?: unknown;
  visitId?: unknown;
  referrer?: unknown;
};

type CountRow = { count: number };
type SummaryRow = {
  page_views: number;
  visits: number;
  previous_page_views: number;
  previous_visits: number;
};
type TrendRow = { day: string; page_views: number; visits: number };
type BreakdownRow = { label: string; count: number };

function normalizePath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 300) return null;
  let path: string;
  try {
    path = new URL(value, "https://hackmusic.fun").pathname;
  } catch {
    return null;
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.startsWith("/api/") || path.startsWith("/backstage-")) return null;
  if (/^\/e\/[A-Za-z0-9]{6}\/host\/?$/.test(path)) return "/e/:room/host";
  if (/^\/e\/[A-Za-z0-9]{6}\/?$/.test(path)) return "/e/:room";
  return path.slice(0, 160) || "/";
}

function normalizeVisitId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9-]{16,64}$/i.test(value)) return null;
  return value.toLowerCase();
}

function referrerHost(value: unknown, request: Request) {
  if (typeof value !== "string" || !value) return "Direct / none";
  try {
    const referrer = new URL(value);
    const current = new URL(request.url);
    if (referrer.hostname === current.hostname) return "Internal";
    return referrer.hostname.toLowerCase().replace(/^www\./, "").slice(0, 100) || "Direct / none";
  } catch {
    return "Direct / none";
  }
}

function deviceClass(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (/bot|crawler|spider|headless|preview/i.test(ua)) return "Bot";
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "Mobile";
  return "Desktop";
}

function countryCode(request: Request) {
  const value = request.headers.get("cf-ipcountry")?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : "Unknown";
}

async function dailyVisitHash(day: string, visitId: string) {
  const bytes = new TextEncoder().encode(`hackmusic-analytics-v1|${day}|${visitId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pruneExpiredPageviews() {
  await getD1().prepare(`DELETE FROM analytics_pageviews WHERE day < date('now', ?)`).bind(`-${RETENTION_DAYS} days`).run();
}

export async function recordPageview(request: Request, input: AnalyticsInput) {
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return false;
  const path = normalizePath(input.path);
  const visitId = normalizeVisitId(input.visitId);
  const device = deviceClass(request);
  if (!path || !visitId || device === "Bot") return false;

  await ensurePartySchema();
  const now = new Date();
  const visitedAt = now.toISOString();
  const day = visitedAt.slice(0, 10);
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`INSERT INTO analytics_pageviews
      (id, visited_at, day, path, visit_hash, referrer_host, device, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        visitedAt,
        day,
        path,
        await dailyVisitHash(day, visitId),
        referrerHost(input.referrer, request),
        device,
        countryCode(request),
      ),
    d1.prepare(`DELETE FROM analytics_pageviews WHERE day < date('now', ?)`).bind(`-${RETENTION_DAYS} days`),
  ]);
  return true;
}

function isoDayOffset(offset: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

function completeTrend(rows: TrendRow[]) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: REPORT_DAYS }, (_, index) => {
    const day = isoDayOffset(index - (REPORT_DAYS - 1));
    const row = byDay.get(day);
    return { day, pageViews: row?.page_views ?? 0, visits: row?.visits ?? 0 };
  });
}

function breakdown(rows: BreakdownRow[], total: number) {
  return rows.map((row) => ({
    label: row.label,
    count: row.count,
    percent: total ? Math.round((row.count / total) * 100) : 0,
  }));
}

export async function readAnalyticsOverview() {
  await ensurePartySchema();
  const d1 = getD1();
  await pruneExpiredPageviews();
  const currentStart = `-${REPORT_DAYS - 1} days`;
  const previousStart = `-${REPORT_DAYS * 2 - 1} days`;
  const previousEnd = `-${REPORT_DAYS} days`;
  const [summary, trend, pages, referrers, devices, countries, retained] = await Promise.all([
    d1.prepare(`SELECT
      SUM(CASE WHEN day >= date('now', ?) THEN 1 ELSE 0 END) AS page_views,
      COUNT(DISTINCT CASE WHEN day >= date('now', ?) THEN visit_hash END) AS visits,
      SUM(CASE WHEN day BETWEEN date('now', ?) AND date('now', ?) THEN 1 ELSE 0 END) AS previous_page_views,
      COUNT(DISTINCT CASE WHEN day BETWEEN date('now', ?) AND date('now', ?) THEN visit_hash END) AS previous_visits
      FROM analytics_pageviews WHERE day >= date('now', ?)`)
      .bind(currentStart, currentStart, previousStart, previousEnd, previousStart, previousEnd, previousStart).first<SummaryRow>(),
    d1.prepare(`SELECT day, COUNT(*) AS page_views, COUNT(DISTINCT visit_hash) AS visits
      FROM analytics_pageviews WHERE day >= date('now', ?) GROUP BY day ORDER BY day ASC`)
      .bind(currentStart).all<TrendRow>(),
    d1.prepare(`SELECT path AS label, COUNT(*) AS count FROM analytics_pageviews
      WHERE day >= date('now', ?) GROUP BY path ORDER BY count DESC, path ASC LIMIT 8`)
      .bind(currentStart).all<BreakdownRow>(),
    d1.prepare(`SELECT referrer_host AS label, COUNT(*) AS count FROM analytics_pageviews
      WHERE day >= date('now', ?) GROUP BY referrer_host ORDER BY count DESC, referrer_host ASC LIMIT 8`)
      .bind(currentStart).all<BreakdownRow>(),
    d1.prepare(`SELECT device AS label, COUNT(*) AS count FROM analytics_pageviews
      WHERE day >= date('now', ?) GROUP BY device ORDER BY count DESC`)
      .bind(currentStart).all<BreakdownRow>(),
    d1.prepare(`SELECT country AS label, COUNT(*) AS count FROM analytics_pageviews
      WHERE day >= date('now', ?) GROUP BY country ORDER BY count DESC LIMIT 8`)
      .bind(currentStart).all<BreakdownRow>(),
    d1.prepare("SELECT COUNT(*) AS count FROM analytics_pageviews").first<CountRow>(),
  ]);

  const pageViews = summary?.page_views ?? 0;
  return {
    periodDays: REPORT_DAYS,
    retentionDays: RETENTION_DAYS,
    pageViews,
    visits: summary?.visits ?? 0,
    previousPageViews: summary?.previous_page_views ?? 0,
    previousVisits: summary?.previous_visits ?? 0,
    retainedPageViews: retained?.count ?? 0,
    trend: completeTrend(trend.results),
    topPages: breakdown(pages.results, pageViews),
    referrers: breakdown(referrers.results, pageViews),
    devices: breakdown(devices.results, pageViews),
    countries: breakdown(countries.results, pageViews),
  };
}
