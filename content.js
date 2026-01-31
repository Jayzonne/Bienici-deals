const SETTINGS_KEY = "biDealsSettings";

const DEFAULTS = {
  enabled: true,
  thresholdPct: 10,     // jaune si dans [-10% ; +10%]
  minCardsGlobal: 8,
  minCardsPerCity: 6,
  showBadge: true,
  debug: false
};

async function loadSettings() {
  const res = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(res[SETTINGS_KEY] || {}) };
}

function normalizeSpaces(s) {
  return (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function parseNumber(text) {
  // "219 500 €/m²" ou "219 500 €" -> 219500
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

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
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
    }
    .bi-badge.bi-under { background: #19a974; color: #fff; }
    .bi-badge.bi-in    { background: #ffd43b; color: #1b1f24; }
    .bi-badge.bi-over  { background: #ff4d4f; color: #fff; }
    .bi-badge small { font-weight: 700; opacity: 0.95; margin-left: 8px; }
  `;
  document.documentElement.appendChild(style);
}

function clearMark(article) {
  article.classList.remove("bi-market", "bi-under", "bi-in", "bi-over");
  const badge = article.querySelector(":scope .bi-badge");
  if (badge) badge.remove();
}

function mark(article, bucket, pctDiff, city, priceM2, marketM2, showBadge) {
  article.classList.add("bi-market", bucket);

  if (!showBadge) return;

  const badge = document.createElement("div");
  badge.className = `bi-badge ${bucket}`;

  const label =
    bucket === "bi-under" ? "Sous marché" :
    bucket === "bi-over"  ? "Au-dessus" :
                            "Dans le marché";

  const sign = pctDiff > 0 ? "+" : "";
  badge.innerHTML = `
    <span>${label} (${sign}${Math.round(pctDiff)}%)</span>
    <small>${city || "zone"} • ${Math.round(priceM2)}€/m² vs ${Math.round(marketM2)}€/m²</small>
  `;

  article.appendChild(badge);
}

/**
 * ✅ Sélecteur fiable : Bien’ici utilise <article class="ad-overview ..."> pour chaque annonce. :contentReference[oaicite:2]{index=2}
 */
function findArticles() {
  return Array.from(document.querySelectorAll("article.ad-overview"));
}

/**
 * ✅ Extraction fiable via classes Bien’ici (vues dans ton HTML) :
 * - Surface : .ad-overview-details__ad-title (ex "Appartement 3 pièces 58 m²") :contentReference[oaicite:3]{index=3}
 * - Adresse/ville : .ad-overview-details__address-title (ex "31500 Toulouse (...)") :contentReference[oaicite:4]{index=4}
 * - Prix : .ad-price__the-price (ex "219 500 €") :contentReference[oaicite:5]{index=5}
 * - Prix/m² : .ad-price__price-per-square-meter (ex "3 815 €/m²") :contentReference[oaicite:6]{index=6}
 */
function extractRow(article) {
  const priceEl = article.querySelector(".ad-price__the-price");
  const ppmEl   = article.querySelector(".ad-price__price-per-square-meter");
  const titleEl = article.querySelector(".ad-overview-details__ad-title");
  const addrEl  = article.querySelector(".ad-overview-details__address-title");

  const price = parseNumber(priceEl?.textContent);
  const priceM2 = parseNumber(ppmEl?.textContent); // ✅ le site le fournit déjà, super fiable
  const title = normalizeSpaces(titleEl?.textContent);
  const addr = normalizeSpaces(addrEl?.textContent);

  if (!price || !priceM2) return null;

  // Ville : on enlève le code postal au début s'il y en a
  // "31500 Toulouse (Château...)" -> "Toulouse"
  let city = null;
  if (addr) {
    const m = addr.match(/^\d{5}\s+([A-Za-zÀ-ÖØ-öø-ÿ'’ -]+)/);
    city = m ? normalizeSpaces(m[1]).split(" (")[0] : addr.split(" (")[0];
  }

  return { article, price, priceM2, city, title, addr };
}

async function analyzeNow(reason = "manual") {
  const settings = await loadSettings();
  if (!settings.enabled) return;

  ensureStyles();

  const articles = findArticles();
  const rows = [];

  for (const a of articles) {
    clearMark(a);
    const r = extractRow(a);
    if (r) rows.push(r);
  }

  if (settings.debug) {
    console.log("[BI]", { reason, articles: articles.length, parsed: rows.length });
  }

  if (rows.length < settings.minCardsGlobal) return;

  const globalMarket = median(rows.map(r => r.priceM2));
  if (!globalMarket) return;

  const byCity = groupBy(rows, r => r.city);
  const marketByCity = new Map();

  for (const [city, items] of byCity.entries()) {
    if (!city) continue;
    if (items.length < settings.minCardsPerCity) continue;
    const m = median(items.map(i => i.priceM2));
    if (m) marketByCity.set(city, m);
  }

  const t = settings.thresholdPct;

  for (const r of rows) {
    const market = (r.city && marketByCity.get(r.city)) ? marketByCity.get(r.city) : globalMarket;
    const pctDiff = ((r.priceM2 - market) / market) * 100;

    let bucket = "bi-in";              // 🟨
    if (pctDiff <= -t) bucket = "bi-under";    // 🟩
    else if (pctDiff >= t) bucket = "bi-over"; // 🟥

    mark(r.article, bucket, pctDiff, r.city, r.priceM2, market, settings.showBadge);
  }
}

/** Scroll infini / rendu dynamique */
let timer = null;
function scheduleAnalyze(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => analyzeNow(reason), 350);
}

const obs = new MutationObserver(() => scheduleAnalyze("dom-change"));
obs.observe(document.documentElement, { childList: true, subtree: true });

// Lancement
scheduleAnalyze("init");
// 🔁 Relance l'analyse dès que l'URL change (SPA)
(function watchUrlChanges() {
  let lastUrl = location.href;

  const onUrlChange = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    scheduleAnalyze("url-change");
  };

  // back/forward
  window.addEventListener("popstate", onUrlChange);

  // pushState/replaceState (navigation interne)
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

  // En secours (certains frameworks modifient l'URL autrement)
  const mo = new MutationObserver(onUrlChange);
  mo.observe(document.querySelector("title") || document.documentElement, { childList: true, subtree: true });
})();
