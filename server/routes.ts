import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import ExcelJS from "exceljs";
import * as fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDFLARE PROXY — routes ALL Yahoo Finance requests through Cloudflare
// Cloudflare IPs are never blocked by Yahoo. Railway IPs are.
// Worker URL: https://gentle-mud-b38b.sethi-adisingh11.workers.dev
// Usage: proxy(yahooUrl) → Cloudflare fetches Yahoo → returns response
// ─────────────────────────────────────────────────────────────────────────────

const CF_WORKER = "https://gentle-mud-b38b.sethi-adisingh11.workers.dev";

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(r => setTimeout(() => r(null), ms)),
  ]);
}

// All Yahoo calls go through Cloudflare proxy
async function yfFetch(yahooUrl: string, timeoutMs = 12000): Promise<any | null> {
  const proxyUrl = `${CF_WORKER}/?url=${encodeURIComponent(yahooUrl)}`;
  try {
    const res = await withTimeout(fetch(proxyUrl), timeoutMs) as Response | null;
    if (!res?.ok) {
      console.warn(`[CF] ${yahooUrl.slice(0, 80)} → HTTP ${res?.status}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.error(`[CF] fetch error:`, e?.message);
    return null;
  }
}

// ── Historical OHLCV via v8/finance/chart ─────────────────────────────────
interface PriceRow { date: Date; close: number; open: number; high: number; low: number; volume: number; }

async function fetchHistoricalData(symbol: string, startDate: string, endDate: string, retries = 3): Promise<PriceRow[] | null> {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime()   / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=history`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const data = await yfFetch(url, 18000);
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.warn(`[hist] ${symbol} attempt ${attempt}: no result`);
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 1500));
      continue;
    }
    const timestamps: number[] = result.timestamp ?? [];
    const closes:     number[] = result.indicators?.quote?.[0]?.close  ?? [];
    const opens:      number[] = result.indicators?.quote?.[0]?.open   ?? [];
    const highs:      number[] = result.indicators?.quote?.[0]?.high   ?? [];
    const lows:       number[] = result.indicators?.quote?.[0]?.low    ?? [];
    const volumes:    number[] = result.indicators?.quote?.[0]?.volume ?? [];

    const rows: PriceRow[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || isNaN(close) || close <= 0) continue;
      rows.push({
        date:   new Date(timestamps[i] * 1000),
        close,
        open:   opens[i]   || close,
        high:   highs[i]   || close,
        low:    lows[i]    || close,
        volume: volumes[i] || 0,
      });
    }
    if (rows.length > 0) {
      console.log(`[hist] ${symbol}: ${rows.length} rows`);
      return rows;
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 1500));
  }
  return null;
}

// ── Quote (price, marketCap, name, currency) via v8 chart meta ────────────
async function yfQuote(symbol: string): Promise<any | null> {
  const p2  = Math.floor(Date.now() / 1000);
  const p1  = p2 - 7 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const data   = await yfFetch(url, 10000);
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta ?? {};
  const quotes = result.indicators?.quote?.[0] ?? {};
  const closes: number[] = quotes.close ?? [];
  const validCloses = closes.filter((c: number) => c != null && !isNaN(c) && c > 0);
  const last = validCloses[validCloses.length - 1] ?? meta.regularMarketPrice;
  const prev = validCloses.length > 1 ? validCloses[validCloses.length - 2] : null;
  if (!last) return null;
  return {
    regularMarketPrice:        last,
    regularMarketPreviousClose: prev ?? meta.previousClose ?? last,
    regularMarketChange:        prev ? last - prev : 0,
    regularMarketChangePercent: prev ? ((last - prev) / prev) * 100 : 0,
    currency:  meta.currency  ?? "INR",
    shortName: meta.shortName ?? symbol,
    longName:  meta.longName  ?? meta.shortName ?? symbol,
    marketCap: meta.marketCap ?? 0,
    symbol:    meta.symbol    ?? symbol,
    lastDate:  result.timestamp?.length
      ? new Date((result.timestamp[result.timestamp.length - 1]) * 1000).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
  };
}

// ── QuoteSummary for financials via v10/v11 ───────────────────────────────
async function yfQuoteSummary(symbol: string, modules: string[]): Promise<any | null> {
  const mods = modules.join(",");
  for (const version of ["v11", "v10"]) {
    for (const host of ["query1", "query2"]) {
      const url  = `https://${host}.finance.yahoo.com/${version}/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}`;
      const data = await yfFetch(url, 12000);
      const result = data?.quoteSummary?.result?.[0];
      if (result && Object.keys(result).length > 0) {
        console.log(`[fin] ${symbol} via ${version}/${host}`);
        return result;
      }
    }
  }
  console.warn(`[fin] ${symbol}: no financials`);
  return null;
}

// ── News via v1/finance/search ────────────────────────────────────────────
async function yfSearch(query: string): Promise<any[]> {
  const url  = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=15&enableFuzzyQuery=false&quotesCount=0`;
  const data = await yfFetch(url, 8000);
  return data?.news ?? [];
}

// ── Symbol/quote search via v1/finance/search ─────────────────────────────
async function yfSearchQuotes(query: string): Promise<any[]> {
  const url  = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&enableFuzzyQuery=false&quotesCount=5`;
  const data = await yfFetch(url, 8000);
  return data?.quotes ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL — Damodaran industry classification
// ─────────────────────────────────────────────────────────────────────────────

let industryList: { symbol: string; name: string; industry: string; sector: string }[] = [];

async function loadExcelData() {
  try {
    const candidates = [
      path.resolve(process.cwd(), "attached_assets", "INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx"),
      path.resolve(process.cwd(), "dist", "attached_assets", "INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx"),
      path.resolve(__dirname, "..", "attached_assets", "INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx"),
    ];
    const filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) { console.error("[Excel] File not found"); return; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.worksheets[0];
    if (!sheet) return;
    const rows: any[][] = [];
    sheet.eachRow(row => rows.push((row.values as any[]).slice(1)));
    if (rows.length < 2) return;
    const h       = rows[0].map((x: any) => String(x ?? "").trim().toLowerCase());
    const nameIdx = h.findIndex(x => x.includes("company") || x === "name");
    const tickIdx = h.findIndex(x => x.includes("ticker") || x === "symbol");
    const indIdx  = h.findIndex(x => x === "industry group" || x === "industry");
    const secIdx  = h.findIndex(x => x === "primary sector" || x === "sector");
    if (tickIdx === -1) { console.error("[Excel] No ticker column"); return; }
    industryList = rows.slice(1).map(row => {
      const raw = String(row[tickIdx] ?? "").trim();
      return {
        symbol:   raw.includes(":") ? raw.split(":")[1] : raw,
        name:     nameIdx !== -1 ? String(row[nameIdx] ?? "").trim() : "",
        industry: indIdx  !== -1 ? String(row[indIdx]  ?? "").trim() : "",
        sector:   secIdx  !== -1 ? String(row[secIdx]  ?? "").trim() : "",
      };
    }).filter(i => i.symbol.length > 0);
    console.log(`[Excel] ${industryList.length} companies loaded`);
  } catch (e) { console.error("[Excel]", e); }
}
loadExcelData();

// ─────────────────────────────────────────────────────────────────────────────
// YAHOO VALUE EXTRACTOR — quoteSummary returns { raw: 123, fmt: "123" } objects
// We always want the raw number
// ─────────────────────────────────────────────────────────────────────────────

function yv(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'object' && val.raw != null) return typeof val.raw === 'number' ? val.raw : null;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINANCIAL METRICS — Beta, Alpha, Volatility, R², Correlation
// ─────────────────────────────────────────────────────────────────────────────

function calcMetrics(s: number[], m: number[]) {
  if (s.length !== m.length || s.length < 10) return null;
  const sr: number[] = [], mr: number[] = [];
  for (let i = 1; i < s.length; i++) {
    sr.push((s[i] - s[i-1]) / s[i-1]);
    mr.push((m[i] - m[i-1]) / m[i-1]);
  }
  const n = sr.length;
  const ms = sr.reduce((a,b) => a+b, 0) / n;
  const mm = mr.reduce((a,b) => a+b, 0) / n;
  let cov = 0, vm = 0, vs = 0;
  for (let i = 0; i < n; i++) {
    cov += (sr[i]-ms) * (mr[i]-mm);
    vm  += (mr[i]-mm) ** 2;
    vs  += (sr[i]-ms) ** 2;
  }
  if (vm === 0 || vs === 0) return null;
  const beta  = cov / vm;
  const alpha = ms - beta * mm;
  const corr  = cov / Math.sqrt(vs * vm);
  return { beta, alpha, correlation: corr, rSquared: corr ** 2, volatility: Math.sqrt(vs / (n-1)) * Math.sqrt(252) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PEERS — Excel-first, industry then sector fallback, market cap filter
// ─────────────────────────────────────────────────────────────────────────────

async function getPeers(ticker: string, exchange: string, exRate: number, companyName = "") {
  const sfx  = exchange === "NSE" ? ".NS" : ".BO";
  const base = ticker.split(".")[0];
  const isNumeric = (s: string) => /^\d+$/.test(s);

  // Step 1: find company in Excel by symbol
  let m = industryList.find(i => i.symbol === base);

  // Step 2: name-based fallback for BSE-only companies (e.g. KOTAKBANK = BSE:500247)
  if (!m && companyName) {
    // Exclude generic words that match everything — only use distinctive words
    const STOP_WORDS = new Set(['limited','india','indian','industries','enterprise','enterprises','corporation','company','holdings','the','and','private','public','bank','finance','financial','services','technology','technologies','solutions','group','international','national','infrastructure','development']);
    const words = companyName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 && !STOP_WORDS.has(w));
    if (words.length > 0) {
      m = industryList.find(i => words.some((w: string) => i.name.toLowerCase().includes(w)));
      if (m) console.log(`[Peers] "${base}" matched to "${m.name}" via name words: ${words.slice(0,3)}`);
    }
  }

  // Step 3: quoteSummary fallback for renamed companies (e.g. Eternal = Zomato)
  if (!m) {
    try {
      const s = await yfQuoteSummary(ticker, ["price"]);
      const n = s?.price?.longName ?? s?.price?.shortName ?? "";
      if (n) {
        const STOP_WORDS = new Set(['limited','india','indian','industries','enterprise','enterprises','corporation','company','holdings','the','and','private','public','bank','finance','financial','services','technology','technologies','solutions','group','international','national','infrastructure','development']);
        const words = n.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 && !STOP_WORDS.has(w));
        if (words.length > 0) {
          m = industryList.find(i => words.some((w: string) => i.name.toLowerCase().includes(w)));
          if (m) console.log(`[Peers] "${base}" matched to "${m.name}" via quoteSummary`);
        }
      }
    } catch {}
  }

  if (!m) { console.log(`[Peers] ${base} not found in Excel`); return []; }

  // Step 4: get peers from Excel — same industry, fallback to sector if < 4
  let peers = industryList.filter(i => i.industry === m!.industry && i.symbol !== m!.symbol);
  if (peers.length < 4 && m.sector) {
    console.log(`[Peers] Only ${peers.length} in industry → expanding to sector "${m.sector}"`);
    peers = industryList.filter(i => i.sector === m!.sector && i.symbol !== m!.symbol);
  }

  console.log(`[Peers] ${base} → ${peers.length} peers from Excel (returning up to 30)`);

  // Step 5: return directly — NO Yahoo validation, NO market cap filter
  // Trust Damodaran Excel completely. marketCap filled later in calculate route.
  return peers.slice(0, 30).map(p => {
    const cleanSymbol = p.symbol.split(",")[0].trim();
    return {
      slug:     isNumeric(cleanSymbol) ? `${cleanSymbol}.BO` : `${cleanSymbol}${sfx}`,
      name:     p.name,
      industry: p.industry,
      sector:   `${p.sector} > ${p.industry}`,
      marketCap: 0,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // Health
  app.get("/api/health", (_req, res) => res.json({
    status: "ok", excelLoaded: industryList.length, uptime: process.uptime(),
    proxy: CF_WORKER,
  }));

  // Test — verify proxy + Yahoo are working
  app.get("/api/test-quote/:symbol", async (req, res) => {
    const q = await yfQuote(req.params.symbol);
    res.json(q ?? { error: "no data — check Cloudflare Worker logs" });
  });

  // Market overview — Nifty, Sensex, News
  app.get("/api/market/overview", async (_req, res) => {
    try {
      const [nifty, sensex, newsItems] = await Promise.all([
        yfQuote("^NSEI"),
        yfQuote("^BSESN"),
        (async () => {
          // Indian financial RSS feeds — guaranteed Indian market news, no auth needed
          const rssFeeds = [
            { url: 'https://economictimes.indiatimes.com/markets/stocks/rss.cms', name: 'Economic Times' },
            { url: 'https://economictimes.indiatimes.com/markets/rss.cms',        name: 'Economic Times' },
            { url: 'https://www.business-standard.com/rss/markets-106.rss',       name: 'Business Standard' },
            { url: 'https://www.moneycontrol.com/rss/latestnews.xml',             name: 'Moneycontrol' },
          ];
          for (const feed of rssFeeds) {
            try {
              const r = await withTimeout(fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/xml,*/*' } }), 6000) as Response | null;
              if (!r?.ok) continue;
              const xml = await r.text();
              const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
              if (!items.length) continue;
              const news = items.slice(0, 15).map((m: any) => {
                const it = m[1];
                const title = (it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || it.match(/<title>(.*?)<\/title>/)?.[1] || '').replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
                const link  = (it.match(/<link>(.*?)<\/link>/)?.[1] || '#').trim();
                const pub   = it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
                const img   = it.match(/<media:content[^>]+url="([^"]+)"/)?.[1] || it.match(/<enclosure[^>]+url="([^"]+)"/)?.[1] || null;
                return { title, publisher: feed.name, link, providerPublishTime: pub ? Math.floor(new Date(pub).getTime()/1000) : Math.floor(Date.now()/1000), thumbnail: img };
              }).filter((n: any) => n.title.length > 10);
              if (news.length >= 5) return news;
            } catch {}
          }
          return [];
        })(),
      ]);

      res.json({
        indices: {
          nifty50: nifty  ? { price: nifty.regularMarketPrice,  change: nifty.regularMarketChange,  changePercent: nifty.regularMarketChangePercent,  prevClose: nifty.regularMarketPreviousClose,  date: nifty.lastDate  } : null,
          sensex:  sensex ? { price: sensex.regularMarketPrice, change: sensex.regularMarketChange, changePercent: sensex.regularMarketChangePercent, prevClose: sensex.regularMarketPreviousClose, date: sensex.lastDate } : null,
        },
        news: newsItems.slice(0, 12).map((n: any) => ({
          title:               n.title ?? "",
          publisher:           n.publisher ?? "NSE/BSE",
          link:                n.link ?? "#",
          providerPublishTime: n.providerPublishTime ?? Math.floor(Date.now() / 1000),
          thumbnail:           n.thumbnail?.resolutions?.[0]?.url ?? n.thumbnail?.resolutions?.[1]?.url ?? null,
        })).filter((n: any) => n.title),
      });
    } catch (e) {
      console.error("[overview]", e);
      res.status(500).json({ message: "Failed to fetch market data" });
    }
  });

  // Beta calculation
  app.post(api.beta.calculate.path, async (req, res) => {
    try {
      const { ticker, exchange, startDate, endDate, period } = api.beta.calculate.input.parse(req.body);
      const sfx   = exchange === "NSE" ? ".NS" : ".BO";
      const mktTk = exchange === "NSE" ? "^NSEI" : "^BSESN";
      const full  = ticker.endsWith(sfx) ? ticker : `${ticker}${sfx}`;

      console.log(`[calculate] ${full} ${startDate} → ${endDate}`);

      const [mktData, stkData, quote, financials, usdInr] = await Promise.all([
        fetchHistoricalData(mktTk, startDate, endDate),
        fetchHistoricalData(full,  startDate, endDate),
        yfQuote(full),
        yfQuoteSummary(full, ["financialData", "defaultKeyStatistics", "summaryDetail", "assetProfile", "price"]),
        yfQuote("USDINR=X"),
      ]);

      if (!mktData?.length || !stkData?.length) {
        console.error(`[calculate] Data missing — market:${mktData?.length ?? 0} stock:${stkData?.length ?? 0}`);
        return res.status(404).json({ message: `Failed to fetch price data for ${full}. Check the ticker symbol.` });
      }

      // Align dates between stock and market data
      const dateMap = new Map<string, number>();
      mktData.forEach(d => {
        if (d?.close) dateMap.set(d.date.toISOString().split("T")[0], d.close);
      });

      const sp: number[] = [], mp: number[] = [];
      stkData.forEach(d => {
        const mv = dateMap.get(d.date.toISOString().split("T")[0]);
        if (mv && d.close) { sp.push(d.close); mp.push(mv); }
      });

      console.log(`[calculate] ${full}: ${sp.length} aligned data points`);

      const metrics = calcMetrics(sp, mp);
      if (!metrics) return res.status(400).json({ message: `Insufficient aligned data points (got ${sp.length}, need ≥10).` });

      const exRate  = usdInr?.regularMarketPrice ?? 83.5;
      const tCurr   = quote?.currency ?? "INR";
      const fCurr   = financials?.financialData?.financialCurrency ?? tCurr;
      const pFact   = tCurr === "USD" ? exRate : 1;
      const fFact   = fCurr === "USD" ? exRate : 1;

      const target = {
        ticker: full,
        name:        financials?.price?.longName ?? financials?.price?.shortName ?? quote?.longName ?? quote?.shortName ?? ticker,
        marketIndex: exchange === "NSE" ? "NIFTY 50" : "BSE SENSEX",
        industry:    financials?.assetProfile?.industry ?? null,
        sector:      financials?.assetProfile?.sector   ?? null,
        exchange,    ...metrics,
        period:      period ?? "5Y",
        dataPoints:  sp.length,
        marketCap:        (yv(financials?.summaryDetail?.marketCap)         ?? yv(quote?.marketCap) ?? 0) * pFact,
        revenue:          (yv(financials?.financialData?.totalRevenue)      ?? 0) * fFact,
        enterpriseValue:  (yv(financials?.defaultKeyStatistics?.enterpriseValue) ?? 0) * pFact,
        evRevenueMultiple: yv(financials?.defaultKeyStatistics?.enterpriseValue) && yv(financials?.financialData?.totalRevenue)
          ? yv(financials.defaultKeyStatistics.enterpriseValue)! / (yv(financials.financialData.totalRevenue)! * fFact / pFact) : undefined,
        peRatio:         yv(financials?.summaryDetail?.trailingPE),
        pbRatio:         yv(financials?.defaultKeyStatistics?.priceToBook),
        dividendYield:   yv(financials?.summaryDetail?.dividendYield),
        ebitda:          (yv(financials?.financialData?.ebitda) ?? 0) * fFact,
        debtToEquity:    yv(financials?.financialData?.debtToEquity),
        profitMargin:    yv(financials?.financialData?.profitMargins),
        grossMargin:     yv(financials?.financialData?.grossMargins),
        operatingMargin: yv(financials?.financialData?.operatingMargins),
        returnOnEquity:  yv(financials?.financialData?.returnOnEquity),
        returnOnAssets:  yv(financials?.financialData?.returnOnAssets),
        currentRatio:    yv(financials?.financialData?.currentRatio),
        sourceUrl: `https://finance.yahoo.com/quote/${full}`,
      };

      const resolvedName = financials?.price?.longName ?? financials?.price?.shortName ?? quote?.longName ?? quote?.shortName ?? "";
      const peerList = await getPeers(full, exchange, exRate, resolvedName);
      const peerResults = await Promise.all(peerList.map(async peer => {
        const [pd, pq, pf] = await Promise.all([
          fetchHistoricalData(peer.slug, startDate, endDate),
          yfQuote(peer.slug),
          yfQuoteSummary(peer.slug, ["financialData", "defaultKeyStatistics", "summaryDetail", "price"]),
        ]);
        if (!pd || pd.length < 10) return null;

        const ps: number[] = [], pm: number[] = [];
        pd.forEach(d => {
          const mv = dateMap.get(d.date.toISOString().split("T")[0]);
          if (mv && d.close) { ps.push(d.close); pm.push(mv); }
        });

        const pMet = calcMetrics(ps, pm);

        // NSE fallback: for BSE numeric codes with missing marketCap, try finding NSE listing
        let effectivePq = pq;
        let effectivePf = pf;
        const initialMarketCap = yv(pf?.summaryDetail?.marketCap) ?? yv(pq?.marketCap) ?? 0;
        if (initialMarketCap === 0 && /^\d+\.BO$/.test(peer.slug) && peer.name) {
          const searchQuotes = await yfSearchQuotes(peer.name);
          const nsSymbol = searchQuotes.find((q: any) => q.symbol?.endsWith('.NS'))?.symbol;
          if (nsSymbol) {
            console.log(`[Peers] NSE fallback: ${peer.slug} → ${nsSymbol}`);
            const [nsPq, nsPf] = await Promise.all([
              yfQuote(nsSymbol),
              yfQuoteSummary(nsSymbol, ["financialData", "defaultKeyStatistics", "summaryDetail", "price"]),
            ]);
            if (nsPq) effectivePq = nsPq;
            if (nsPf) effectivePf = nsPf;
          }
        }

        const pcurr  = effectivePq?.currency ?? "INR";
        const pfcurr = effectivePf?.financialData?.financialCurrency ?? pcurr;
        const ppf    = pcurr  === "USD" ? exRate : 1;
        const pff    = pfcurr === "USD" ? exRate : 1;

        const cleanTicker = peer.slug.includes(",") ? peer.slug.split(",")[0] : peer.slug;

        return {
          ticker:    cleanTicker,
          name:      effectivePf?.price?.longName ?? effectivePf?.price?.shortName ?? effectivePq?.longName ?? effectivePq?.shortName ?? peer.name ?? peer.slug,
          industry:  peer.industry,
          sector:    peer.sector,
          beta:            pMet?.beta        ?? null,
          volatility:      pMet?.volatility  ?? null,
          alpha:           pMet?.alpha       ?? null,
          correlation:     pMet?.correlation ?? null,
          rSquared:        pMet?.rSquared    ?? null,
          marketCap:       (yv(effectivePf?.summaryDetail?.marketCap)         ?? yv(effectivePq?.marketCap) ?? 0) * ppf,
          revenue:         (yv(effectivePf?.financialData?.totalRevenue)      ?? 0) * pff,
          enterpriseValue: (yv(effectivePf?.defaultKeyStatistics?.enterpriseValue) ?? 0) * ppf,
          evRevenueMultiple: yv(effectivePf?.defaultKeyStatistics?.enterpriseValue) && yv(effectivePf?.financialData?.totalRevenue)
            ? yv(effectivePf.defaultKeyStatistics.enterpriseValue)! / (yv(effectivePf.financialData.totalRevenue)! * pff / ppf) : undefined,
          peRatio:         yv(effectivePf?.summaryDetail?.trailingPE),
          pbRatio:         yv(effectivePf?.defaultKeyStatistics?.priceToBook),
          dividendYield:   yv(effectivePf?.summaryDetail?.dividendYield),
          ebitda:          (yv(effectivePf?.financialData?.ebitda) ?? 0) * pff,
          debtToEquity:    yv(effectivePf?.financialData?.debtToEquity),
          profitMargin:    yv(effectivePf?.financialData?.profitMargins),
          grossMargin:     yv(effectivePf?.financialData?.grossMargins),
          operatingMargin: yv(effectivePf?.financialData?.operatingMargins),
          returnOnEquity:  yv(effectivePf?.financialData?.returnOnEquity),
          returnOnAssets:  yv(effectivePf?.financialData?.returnOnAssets),
          currentRatio:    yv(effectivePf?.financialData?.currentRatio),
          sourceUrl: `https://finance.yahoo.com/quote/${cleanTicker}`,
        };
      }));

      const validPeers = peerResults.filter((p): p is NonNullable<typeof p> => p !== null && p.beta !== null);
      const targetMarketCap = target.marketCap ?? 0;

      // Group A: peers with marketCap data; Group B: peers without
      const groupA = validPeers.filter(p => (p.marketCap ?? 0) > 0);
      const groupB = validPeers.filter(p => !p.marketCap || p.marketCap <= 0);

      // Sort group A by proximity to target market cap (most size-comparable first)
      groupA.sort((a, b) => Math.abs((a.marketCap ?? 0) - targetMarketCap) - Math.abs((b.marketCap ?? 0) - targetMarketCap));

      // Select top 10 — fill remaining slots from group B if needed
      const selected = groupA.slice(0, 10);
      if (selected.length < 10) selected.push(...groupB.slice(0, 10 - selected.length));

      // Final display order: descending by marketCap (largest first)
      const finalPeers = selected.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

      await storage.createSearch({ ticker: full, exchange, startDate, endDate, beta: metrics.beta, peers: finalPeers as any });
      res.json({ ...target, peers: finalPeers });

    } catch (e) {
      console.error("[calculate]", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
