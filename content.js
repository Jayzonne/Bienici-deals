// Bienici "deal" highlighter — GLOBAL market median over pages 1..12 (cached by URL ignoring page=)
// - One single market per search (no per-city market)
// - Tries to paginate Bienici's /realEstateAds.json request captured via PerformanceObserver (CSP-safe)
// - Falls back to current-page median if API template can't be captured
// - Minimizes flashing: only updates DOM when values change; ignores self-mutations

const SETTINGS_KEY = "biDealsSettings";

const DEFAULTS = {
  enabled: true,
  thresholdPct: 10,     // jaune si dans [-10% ; +10%]
  minCardsGlobal: 8,
  showBadge: true,
  debug: false
};

async function loadSettings() {
  try {
    const res = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...DEFAULTS, ...(res?.[SETTINGS_KEY] || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function normalizeSpaces(s) {
  return (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function parseNumber(text) {
  const t = normalizeSpaces(text);
  const digits = t.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  const arr = values.slice().filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function ensureStyles() {
  if (document.getElementById("bi-style")) return;
  const style = document.createElement("style");
  style.id = "bi-style";
  style.textContent = `
    article.ad-overview.bi-market { position: relative !important; border-radius: 12px !important; }

    article.ad-overview.bi-under {
      outline: 3px solid #19a974 !important;
      box-shadow: 0 0 0 6px rgba(25,169,116,0.22) !important;
    }
    article.ad-overview.bi-in {
      outline: 3px solid #ffd43b !important;
      box-shadow: 0 0 0 6px rgba(255,212,59,0.22) !important;
    }
    article.ad-overview.bi-over {
      outline: 3px solid #ff4d4f !important;
      box-shadow: 0 0 0 6px rgba(255,77,79,0.22) !important;
    }

    .bi-badge {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 999999;
      padding: 6px 10px;
      border-radius: 999px;
      font: 800 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      white-space: nowrap;
      pointer-events: none;
    }
    .bi-badge.bi-under { background: #19a974; color: #fff; }
    .bi-badge.bi-in    { background: #ffd43b; color: #1b1f24; }
    .bi-badge.bi-over  { background: #ff4d4f; color: #fff; }
    .bi-badge small { font-weight: 700; opacity: 0.95; margin-left: 8px; }
  `;
  document.documentElement.appendChild(style);
}

function findArticles(root = document) {
  return Array.from(root.querySelectorAll("article.ad-overview"));
}

function extractRow(article) {
  const ppmEl  = article.querySelector(".ad-price__price-per-square-meter");
  const addrEl = article.querySelector(".ad-overview-details__address-title");

  const priceM2 = parseNumber(ppmEl?.textContent);
  const addr = normalizeSpaces(addrEl?.textContent);

  if (!priceM2) return null;

  let city = null;
  if (addr) {
    const m = addr.match(/^\d{5}\s+([A-Za-zÀ-ÖØ-öø-ÿ'’ -]+)/);
    city = m ? normalizeSpaces(m[1]).split(" (")[0] : addr.split(" (")[0];
  }

  return { article, priceM2, city };
}

function mark(article, bucket, pctDiff, city, priceM2, marketM2, showBadge) {
  const pctRounded = Math.round(pctDiff);
  const marketRounded = Math.round(marketM2);
  const nextKey = `${bucket}|${pctRounded}|${marketRounded}`;
  if (article.dataset.biMarketKey === nextKey) return;

  article.classList.add("bi-market");
  article.classList.remove("bi-under", "bi-in", "bi-over");
  article.classList.add(bucket);
  article.dataset.biMarketKey = nextKey;

  const existing = article.querySelector(":scope .bi-badge");
  if (!showBadge) {
    if (existing) existing.remove();
    return;
  }

  const label =
    bucket === "bi-under" ? "Sous marché" :
    bucket === "bi-over"  ? "Au-dessus" :
                            "Dans le marché";

  const sign = pctRounded > 0 ? "+" : "";
  const html = `
    <span>${label} (${sign}${pctRounded}%)</span>
    <small>${city || "zone"} • ${Math.round(priceM2)}€/m² vs ${marketRounded}€/m²</small>
  `;

  if (existing) {
    existing.className = `bi-badge ${bucket}`;
    if (existing.innerHTML !== html) existing.innerHTML = html;
  } else {
    const badge = document.createElement("div");
    badge.className = `bi-badge ${bucket}`;
    badge.innerHTML = html;
    article.appendChild(badge);
  }
}

/**
 * -------------------------------
 * Marché multi-pages via API JSON
 * -------------------------------
 */
const MARKET_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const marketCache = new Map();   // canonicalUrl -> { fetchedAt, globalMarket, totalRows }
const marketPromise = new Map(); // canonicalUrl -> Promise<entry|null>

function canonicalizeUrlIgnoringPage(href) {
  const u = new URL(href);
  u.searchParams.delete("page");
  u.hash = "";
  const entries = Array.from(u.searchParams.entries()).sort(([a],[b]) => a.localeCompare(b));
  u.search = entries.length ? new URLSearchParams(entries).toString() : "";
  return u.toString();
}

let lastDebugSig = null;

let latestApiUrl = null;

// Capture /realEstateAds.json via PerformanceObserver (CSP-safe; no inline injection)
(function observeApiCalls() {
  try {
    const pick = (name) => {
      if (typeof name === "string" && name.includes("/realEstateAds.json")) latestApiUrl = name;
    };

    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (const e of entries) pick(e?.name);
    } catch {}

    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) pick(e?.name);
    });
    po.observe({ type: "resource", buffered: true });
  } catch {}
})();

function tryParseApiTemplate(apiUrl) {
  try {
    const u = new URL(apiUrl, location.origin);
    if (!u.pathname.endsWith("/realEstateAds.json")) return null;
    const filtersStr = u.searchParams.get("filters");
    if (!filtersStr) return null;

    const filtersObj = JSON.parse(filtersStr);

    const otherParams = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (k === "filters") continue;
      otherParams[k] = v;
    }

    return { endpoint: `${u.origin}${u.pathname}`, filtersObj, otherParams };
  } catch {
    return null;
  }
}

function buildApiUrlForPage(template, pageNum) {
  const size = Number(template?.filtersObj?.size) || 24;
  const filters = { ...template.filtersObj, page: pageNum, from: (pageNum - 1) * size };

  const u = new URL(template.endpoint);
  u.searchParams.set("filters", JSON.stringify(filters));
  for (const [k, v] of Object.entries(template.otherParams || {})) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function extractRowsFromApiJson(json) {
  const ads = json?.realEstateAds || json?.ads || json?.results || [];
  const rows = [];

  const pickNumber = (v) => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "object") {
      const n1 = pickNumber(v.value);
      if (n1 != null) return n1;
      const n2 = pickNumber(v.amount);
      if (n2 != null) return n2;
      const n3 = pickNumber(v.raw);
      if (n3 != null) return n3;
    }
    return null;
  };

  for (const ad of ads) {
    const id = String(ad?.id ?? ad?.realEstateAdId ?? ad?._id ?? ad?.uuid ?? "");
    // Prefer server-calculated €/m² when present (matches UI more reliably)
    let ppm2 =
      pickNumber(ad?.pricePerSquareMeter) ??
      pickNumber(ad?.price_per_square_meter) ??
      pickNumber(ad?.displayPricePerSquareMeter) ??
      pickNumber(ad?.pricePerSquareMeterRounded);

    if (ppm2 == null && ad?.prices) {
      ppm2 =
        pickNumber(ad.prices?.pricePerSquareMeter) ??
        pickNumber(ad.prices?.pricePerSquareMeterRounded);
    }

    // Fallback: compute from price + living area
    if (ppm2 == null) {
      const price =
        pickNumber(ad?.price) ??
        pickNumber(ad?.monthlyPrice) ??
        pickNumber(ad?.rent) ??
        pickNumber(ad?.rentPrice);
      const area =
        pickNumber(ad?.livingArea) ??
        pickNumber(ad?.surfaceArea) ??
        pickNumber(ad?.area) ??
        pickNumber(ad?.totalArea);
      if (price != null && area != null && price > 0 && area > 0) ppm2 = price / area;
    }

    if (!Number.isFinite(ppm2) || ppm2 <= 0) continue;
    rows.push({ id: id || null, ppm2 });
  }
  return rows;
}

async function fetchMarketRowsForPageViaApi(template, pageNum) {
  const url = buildApiUrlForPage(template, pageNum);
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "accept": "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return extractRowsFromApiJson(json);
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i], i); }
      catch { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

async function waitForApiTemplate(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tpl = latestApiUrl ? tryParseApiTemplate(latestApiUrl) : null;
    if (tpl) return tpl;
    await new Promise(r => setTimeout(r, 120));
  }
  return null;
}

async function getOrBuildMarketStats(canonicalUrl, settings) {
  const now = Date.now();
  const cached = marketCache.get(canonicalUrl);
  if (cached && (now - cached.fetchedAt) < MARKET_CACHE_TTL_MS) return cached;

  if (marketPromise.has(canonicalUrl)) return await marketPromise.get(canonicalUrl);

  const p = (async () => {
    const tpl = await waitForApiTemplate(2500);
    if (!tpl) return null;

    // First page to discover total results and page size
    const size = Number(tpl?.filtersObj?.size) || 26;

    const pickTotal = (json) => {
      // Bienici responses vary; try common keys
      const candidates = [
        json?.total,
        json?.totalResults,
        json?.totalResult,
        json?.totalRealEstateAds,
        json?.totalRealEstateAd,
        json?.count,
        json?.totalCount,
        json?.nbResults,
        json?.numberOfResults
      ];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      // sometimes nested
      const nested = json?.paging?.total ?? json?.pagination?.total ?? json?.meta?.total;
      const n2 = Number(nested);
      return (Number.isFinite(n2) && n2 >= 0) ? n2 : null;
    };

    let firstJson = null;
    let firstRows = [];
    try {
      const firstUrl = buildApiUrlForPage(tpl, 1);
      const res = await fetch(firstUrl, {
        credentials: "include",
        headers: {
          "accept": "application/json, text/plain, */*",
          "x-requested-with": "XMLHttpRequest"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      firstJson = await res.json();
      firstRows = extractRowsFromApiJson(firstJson);
    } catch {
      return null;
    }

    const total = pickTotal(firstJson);
    // If total is known and small, don't fetch empty pages.
    const maxPagesFromTotal = total != null ? Math.max(1, Math.ceil(total / size)) : 12;
    const maxPages = Math.min(12, maxPagesFromTotal);

    const pages = [];
    for (let p = 1; p <= maxPages; p++) pages.push(p);

    // Fetch remaining pages (page 1 already done)
    const results = await mapWithConcurrency(pages, 3, async (p) => {
      if (p === 1) return firstRows;
      return await fetchMarketRowsForPageViaApi(tpl, p);
    });

    // Deduplicate by id when possible (avoids inflated totals / duplicates)
    const seen = new Set();
    const all = [];

    for (const arr of results) {
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        const id = row?.id;
        const v = row?.ppm2;
        if (!Number.isFinite(v) || v <= 0) continue;
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        all.push(v);
      }
    }

    if (all.length < settings.minCardsGlobal) return null;

    const globalMarket = median(all);
    if (!globalMarket) return null;

    const entry = { fetchedAt: Date.now(), globalMarket, totalRows: all.length, pagesFetched: maxPages, totalHint: total };
    marketCache.set(canonicalUrl, entry);
    return entry;
  })();

  marketPromise.set(canonicalUrl, p);
  try {
    return await p;
  } finally {
    marketPromise.delete(canonicalUrl);
  }
}

/**
 * -------------------------------
 * Analyse & marquage
 * -------------------------------
 */
let latestRunId = 0;
let isApplying = false;
let mo = null;

async function analyzeNow(reason) {
  const runId = ++latestRunId;

  const settings = await loadSettings();
  if (!settings.enabled) return;

  ensureStyles();

  const rows = [];
  for (const a of findArticles()) {
    const r = extractRow(a);
    if (r) rows.push(r);
  }
  if (rows.length < settings.minCardsGlobal) return;

  const canonicalUrl = canonicalizeUrlIgnoringPage(location.href);

  let globalMarket = null;
  try {
    const stats = await getOrBuildMarketStats(canonicalUrl, settings);
    globalMarket = stats?.globalMarket || null;
    if (settings.debug && stats) {
      const sig = `${reason}|${canonicalUrl}|${Math.round(stats.globalMarket)}|${stats.totalRows}|${stats.pagesFetched || ""}`;
      if (sig !== lastDebugSig) {
        lastDebugSig = sig;
        console.log("[BI] market(12p)", {
          reason,
          canonicalUrl,
          globalMarket: Math.round(stats.globalMarket),
          totalRows: stats.totalRows,
          pagesFetched: stats.pagesFetched,
          totalHint: stats.totalHint
        });
      }
    }
  } catch (e) {
    if (settings.debug) console.warn("[BI] market fetch error", e);
  }

  if (runId !== latestRunId) return;

  // Fallback stable: if API unavailable, we use page median and we DO NOT "re-flip" later
  if (!globalMarket) {
    globalMarket = median(rows.map(r => r.priceM2));
    if (!globalMarket) return;
    if (settings.debug) console.log("[BI] fallback market(page)", { reason, globalMarket: Math.round(globalMarket) });
  }

  const t = settings.thresholdPct;

  // Avoid self-triggered MutationObserver loops
  if (mo) mo.disconnect();
  isApplying = true;
  try {
    for (const r of rows) {
      const pctDiff = ((r.priceM2 - globalMarket) / globalMarket) * 100;
      let bucket = "bi-in";
      if (pctDiff <= -t) bucket = "bi-under";
      else if (pctDiff >= t) bucket = "bi-over";
      mark(r.article, bucket, pctDiff, r.city, r.priceM2, globalMarket, settings.showBadge);
    }
  } finally {
    isApplying = false;
    if (mo) mo.observe(document.documentElement, { childList: true, subtree: true });
  }
}

let timer = null;
function scheduleAnalyze(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => analyzeNow(reason), 700);
}

mo = new MutationObserver((mutations) => {
  if (isApplying) return;

  // Ignore most page mutations (e.g. GTM/adblock retry scripts).
  // Only react when ad cards are added/removed or when something inside cards changes.
  const touchesAds = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const el = /** @type {Element} */ (node);
    if (el.matches?.("article.ad-overview")) return true;
    return !!el.querySelector?.("article.ad-overview");
  };

  let relevant = false;
  for (const m of mutations) {
    for (const n of Array.from(m.addedNodes || [])) {
      if (touchesAds(n)) { relevant = true; break; }
    }
    if (relevant) break;
    for (const n of Array.from(m.removedNodes || [])) {
      if (touchesAds(n)) { relevant = true; break; }
    }
    if (relevant) break;
  }

  if (relevant) scheduleAnalyze("dom-change");
});
mo.observe(document.documentElement, { childList: true, subtree: true });

(function watchUrlChanges() {
  let lastUrl = location.href;

  const onUrlChange = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    scheduleAnalyze("url-change");
  };

  window.addEventListener("popstate", onUrlChange);

  const _pushState = history.pushState;
  history.pushState = function (...args) {
    const ret = _pushState.apply(this, args);
    onUrlChange();
    return ret;
  };

  const _replaceState = history.replaceState;
  history.replaceState = function (...args) {
    const ret = _replaceState.apply(this, args);
    onUrlChange();
    return ret;
  };

  const titleMo = new MutationObserver(onUrlChange);
  titleMo.observe(document.querySelector("title") || document.documentElement, { childList: true, subtree: true });
})();

// Start
scheduleAnalyze("init");
