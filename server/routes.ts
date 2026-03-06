import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import YahooFinance from 'yahoo-finance2';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// YAHOO FINANCE — DEFINITIVE RAILWAY FIX
//
// CONFIRMED WORKING on Railway:  yf.historical() → uses v8/finance/chart CDN
// CONFIRMED BROKEN on Railway:   yf.quote()      → uses v7/finance/quote (needs crumb)
//                                yf.quoteSummary()→ uses v10/v11 (needs crumb)
//                                raw fetch()      → all blocked by Railway IP
//
// SOLUTION: Use yf.chart() for all price/meta data. It uses the same v8/chart
// endpoint as historical(), so it works without auth. For financials we use
// yf.quoteSummary() but handle failure gracefully (show N/A in UI).
// ─────────────────────────────────────────────────────────────────────────────

const yf = new YahooFinance({
  fetchOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
  suppressNotices: ['yahooSurvey'],
});

// Try to set up cookie/crumb — improves financial data richness but NOT required
async function tryAuth() {
  try { await (yf as any).validateCookies(); console.log('[Yahoo] Auth ok'); }
  catch { console.log('[Yahoo] No auth — running in no-crumb mode (chart endpoints still work)'); }
}
tryAuth();
setInterval(tryAuth, 20 * 60 * 1000);

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))]);
}

// ── yfChart: uses v8/finance/chart — CONFIRMED WORKING on Railway ──────────
// Returns price meta: regularMarketPrice, previousClose, currency, shortName, marketCap
async function yfChart(symbol: string): Promise<any | null> {
  try {
    const result = await withTimeout(
      yf.chart(symbol, { period1: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), interval: '1d' }),
      10000
    );
    if (!result) return null;
    const meta = (result as any).meta;
    if (!meta?.regularMarketPrice) return null;
    return {
      regularMarketPrice:        meta.regularMarketPrice,
      regularMarketPreviousClose: meta.previousClose ?? meta.chartPreviousClose,
      regularMarketChange:       meta.regularMarketPrice - (meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice),
      regularMarketChangePercent: meta.previousClose
        ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0,
      currency:  meta.currency  ?? 'INR',
      shortName: meta.shortName ?? symbol,
      longName:  meta.longName  ?? meta.shortName ?? symbol,
      marketCap: meta.marketCap ?? 0,
      symbol:    meta.symbol    ?? symbol,
    };
  } catch { return null; }
}

// ── yfFinancials: uses quoteSummary — may fail without crumb, returns null gracefully
async function yfFinancials(symbol: string): Promise<any | null> {
  try {
    return await withTimeout(
      yf.quoteSummary(symbol, { modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'assetProfile'] as any }),
      12000
    );
  } catch { return null; }
}

// ── yfNews: search for news headlines ─────────────────────────────────────
async function yfNews(query: string): Promise<any[]> {
  try {
    const result = await withTimeout(yf.search(query, { newsCount: 15 } as any), 8000);
    return (result as any)?.news ?? [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL
// ─────────────────────────────────────────────────────────────────────────────

let industryList: { symbol: string; name: string; industry: string; sector: string }[] = [];

async function loadExcelData() {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'attached_assets', 'INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx'),
      path.resolve(process.cwd(), 'dist', 'attached_assets', 'INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx'),
      path.resolve(__dirname, '..', 'attached_assets', 'INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx'),
    ];
    const filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) { console.error('[Excel] Not found'); return; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.worksheets[0];
    if (!sheet) return;
    const rows: any[][] = [];
    sheet.eachRow(row => rows.push((row.values as any[]).slice(1)));
    if (rows.length < 2) return;
    const h         = rows[0].map((x: any) => String(x ?? '').trim().toLowerCase());
    const nameIdx   = h.findIndex(x => x.includes('company') || x === 'name');
    const tickIdx   = h.findIndex(x => x.includes('ticker') || x === 'symbol');
    const indIdx    = h.findIndex(x => x === 'industry group' || x === 'industry');
    const secIdx    = h.findIndex(x => x === 'primary sector' || x === 'sector');
    if (tickIdx === -1) return;
    industryList = rows.slice(1).map(row => {
      const raw = String(row[tickIdx] ?? '').trim();
      return {
        symbol:   raw.includes(':') ? raw.split(':')[1] : raw,
        name:     nameIdx !== -1 ? String(row[nameIdx] ?? '').trim() : '',
        industry: indIdx  !== -1 ? String(row[indIdx]  ?? '').trim() : '',
        sector:   secIdx  !== -1 ? String(row[secIdx]  ?? '').trim() : '',
      };
    }).filter(i => i.symbol.length > 0);
    console.log(`[Excel] ${industryList.length} companies loaded`);
  } catch (e) { console.error('[Excel]', e); }
}
loadExcelData();

// ─────────────────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────────────────

function calcMetrics(s: number[], m: number[]) {
  if (s.length !== m.length || s.length < 10) return null;
  const sr: number[] = [], mr: number[] = [];
  for (let i = 1; i < s.length; i++) {
    sr.push((s[i]-s[i-1])/s[i-1]);
    mr.push((m[i]-m[i-1])/m[i-1]);
  }
  const n = sr.length;
  const ms = sr.reduce((a,b)=>a+b,0)/n, mm = mr.reduce((a,b)=>a+b,0)/n;
  let cov=0, vm=0, vs=0;
  for (let i=0;i<n;i++) { cov+=(sr[i]-ms)*(mr[i]-mm); vm+=(mr[i]-mm)**2; vs+=(sr[i]-ms)**2; }
  if (vm===0||vs===0) return null;
  const beta=cov/vm, alpha=ms-beta*mm, corr=cov/Math.sqrt(vs*vm);
  return { beta, alpha, correlation: corr, rSquared: corr**2, volatility: Math.sqrt(vs/(n-1))*Math.sqrt(252) };
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORICAL — uses v8/chart, confirmed working on Railway
// ─────────────────────────────────────────────────────────────────────────────

async function fetchHistory(ticker: string, start: string, end: string, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const r = await withTimeout(
        yf.historical(ticker, { period1: new Date(start), period2: new Date(end), interval: '1d' }),
        18000
      );
      if (r && r.length > 0) return r;
    } catch (e: any) { console.warn(`[hist] ${ticker} #${i}: ${e?.message}`); }
    if (i < retries) await new Promise(r => setTimeout(r, i * 1500));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PEERS
// ─────────────────────────────────────────────────────────────────────────────

async function getPeers(ticker: string, exchange: string, exRate: number) {
  const sfx  = exchange === 'NSE' ? '.NS' : '.BO';
  const base = ticker.split('.')[0];
  const m    = industryList.find(i => i.symbol === base);
  if (!m) return [];

  let peers = industryList.filter(i => i.industry === m.industry && i.symbol !== base);
  if (peers.length < 4 && m.sector) {
    console.log(`[Peers] ${base}: ${peers.length} → expanding to sector "${m.sector}"`);
    peers = industryList.filter(i => i.sector === m.sector && i.symbol !== base);
  }

  const targetQ  = await yfChart(ticker);
  const targetCap = (targetQ?.marketCap ?? 0) * (targetQ?.currency === 'USD' ? exRate : 1);
  const syms     = peers.slice(0, 30).map(p => `${p.symbol}${sfx}`);
  const quotes: any[] = [];

  for (let i = 0; i < syms.length; i += 6) {
    const batch = await Promise.all(syms.slice(i, i+6).map(s => yfChart(s)));
    quotes.push(...batch);
    if (i+6 < syms.length) await new Promise(r => setTimeout(r, 300));
  }

  const results = [];
  for (let i = 0; i < syms.length; i++) {
    const q = quotes[i]; if (!q) continue;
    const cap = (q.marketCap ?? 0) * (q.currency === 'USD' ? exRate : 1);
    if (cap <= 0) continue;
    if (targetCap > 0) { const r = cap/targetCap; if (r < 0.03 || r > 33) continue; }
    const e = industryList.find(i => i.symbol === syms[i].split('.')[0]);
    results.push({ slug: syms[i], industry: e?.industry ?? 'Unknown', sector: `${e?.sector ?? 'Unknown'} > ${e?.industry ?? 'Unknown'}`, marketCap: cap });
  }
  return results.sort((a,b) => b.marketCap - a.marketCap).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', excelLoaded: industryList.length, uptime: process.uptime(),
  }));

  app.get('/api/refresh-session', async (_req, res) => { await tryAuth(); res.json({ ok: true }); });

  // Test endpoint — uses yfChart (v8/chart) which is confirmed working
  app.get('/api/test-quote/:symbol', async (req, res) => {
    const q = await yfChart(req.params.symbol);
    res.json(q ?? { error: 'no data' });
  });

  app.get('/api/market/overview', async (_req, res) => {
    try {
      const [nifty, sensex, news] = await Promise.all([
        yfChart('^NSEI'),
        yfChart('^BSESN'),
        (async () => {
          for (const q of ['India stock market', 'NIFTY NSE', 'BSE Sensex']) {
            const items = await yfNews(q);
            if (items.length) return items;
          }
          return [];
        })(),
      ]);
      res.json({
        indices: {
          nifty50: nifty  ? { price: nifty.regularMarketPrice,  change: nifty.regularMarketChange,  changePercent: nifty.regularMarketChangePercent,  prevClose: nifty.regularMarketPreviousClose  } : null,
          sensex:  sensex ? { price: sensex.regularMarketPrice, change: sensex.regularMarketChange, changePercent: sensex.regularMarketChangePercent, prevClose: sensex.regularMarketPreviousClose } : null,
        },
        news: news.slice(0, 12).map((n: any) => ({
          title: n.title ?? '', publisher: n.publisher ?? 'NSE/BSE', link: n.link ?? '#',
          providerPublishTime: n.providerPublishTime ?? Math.floor(Date.now()/1000),
          thumbnail: n.thumbnail?.resolutions?.[0]?.url ?? n.thumbnail?.resolutions?.[1]?.url ?? null,
        })).filter((n: any) => n.title),
      });
    } catch (e) { console.error('[overview]', e); res.status(500).json({ message: 'Failed' }); }
  });

  app.post(api.beta.calculate.path, async (req, res) => {
    try {
      const { ticker, exchange, startDate, endDate, period } = api.beta.calculate.input.parse(req.body);
      const sfx   = exchange === 'NSE' ? '.NS' : '.BO';
      const mktTk = exchange === 'NSE' ? '^NSEI' : '^BSESN';
      const full  = ticker.endsWith(sfx) ? ticker : `${ticker}${sfx}`;

      // All four fetch in parallel — chart for price, financials for fundamentals
      const [mktData, stkData, quote, fin, usdInr] = await Promise.all([
        fetchHistory(mktTk, startDate, endDate),
        fetchHistory(full,  startDate, endDate),
        yfChart(full),          // v8/chart — works on Railway
        yfFinancials(full),     // v10/v11 — works if crumb available, null if not
        yfChart('USDINR=X'),    // v8/chart — works on Railway
      ]);

      if (!mktData?.length || !stkData?.length)
        return res.status(404).json({ message: 'Failed to fetch price data. Check the ticker symbol.' });

      const dateMap = new Map<string,number>();
      mktData.forEach(d => { if (d?.close) dateMap.set(d.date.toISOString().split('T')[0], d.close); });
      const sp: number[] = [], mp: number[] = [];
      stkData.forEach(d => { const m = dateMap.get(d.date.toISOString().split('T')[0]); if (m && d.close) { sp.push(d.close); mp.push(m); } });

      const metrics = calcMetrics(sp, mp);
      if (!metrics) return res.status(400).json({ message: 'Insufficient data points.' });

      const exRate = usdInr?.regularMarketPrice ?? 83.5;
      const tCurr  = quote?.currency ?? 'INR';
      const fCurr  = fin?.financialData?.financialCurrency ?? tCurr;
      const pFact  = tCurr === 'USD' ? exRate : 1;
      const fFact  = fCurr === 'USD' ? exRate : 1;

      const target = {
        ticker: full,
        name:        quote?.longName ?? quote?.shortName ?? ticker,
        marketIndex: exchange === 'NSE' ? 'NIFTY 50' : 'BSE SENSEX',
        industry:    fin?.assetProfile?.industry   ?? null,
        sector:      fin?.assetProfile?.sector     ?? null,
        exchange,   ...metrics, period: period ?? '5Y', dataPoints: sp.length,
        marketCap:        (quote?.marketCap ?? 0) * pFact,
        revenue:          (fin?.financialData?.totalRevenue ?? 0) * fFact,
        enterpriseValue:  (fin?.defaultKeyStatistics?.enterpriseValue ?? 0) * pFact,
        evRevenueMultiple: fin?.defaultKeyStatistics?.enterpriseValue && fin?.financialData?.totalRevenue
          ? fin.defaultKeyStatistics.enterpriseValue / (fin.financialData.totalRevenue * fFact / pFact) : undefined,
        peRatio:         fin?.summaryDetail?.trailingPE                ?? null,
        pbRatio:         fin?.defaultKeyStatistics?.priceToBook        ?? null,
        dividendYield:   fin?.summaryDetail?.dividendYield             ?? null,
        ebitda:          (fin?.financialData?.ebitda ?? 0) * fFact,
        debtToEquity:    fin?.financialData?.debtToEquity              ?? null,
        profitMargin:    fin?.financialData?.profitMargins             ?? null,
        grossMargin:     fin?.financialData?.grossMargins              ?? null,
        operatingMargin: fin?.financialData?.operatingMargins          ?? null,
        returnOnEquity:  fin?.financialData?.returnOnEquity            ?? null,
        returnOnAssets:  fin?.financialData?.returnOnAssets            ?? null,
        currentRatio:    fin?.financialData?.currentRatio              ?? null,
        sourceUrl: `https://finance.yahoo.com/quote/${full}`,
      };

      const peerList = await getPeers(full, exchange, exRate);
      const peers = await Promise.all(peerList.map(async peer => {
        const [pd, pq, pf] = await Promise.all([
          fetchHistory(peer.slug, startDate, endDate),
          yfChart(peer.slug),
          yfFinancials(peer.slug),
        ]);
        if (!pd || pd.length < 10) return null;
        const ps: number[] = [], pm: number[] = [];
        pd.forEach(d => { const m = dateMap.get(d.date.toISOString().split('T')[0]); if (m && d.close) { ps.push(d.close); pm.push(m); } });
        const pm2    = calcMetrics(ps, pm);
        const pcurr  = pq?.currency ?? 'INR';
        const pfcurr = pf?.financialData?.financialCurrency ?? pcurr;
        const ppf    = pcurr  === 'USD' ? exRate : 1;
        const pff    = pfcurr === 'USD' ? exRate : 1;
        return {
          ticker: peer.slug, name: pq?.shortName ?? peer.slug,
          industry: peer.industry, sector: peer.sector,
          beta: pm2?.beta ?? null, volatility: pm2?.volatility ?? null,
          alpha: pm2?.alpha ?? null, correlation: pm2?.correlation ?? null, rSquared: pm2?.rSquared ?? null,
          marketCap:       (pq?.marketCap ?? 0) * ppf,
          revenue:         (pf?.financialData?.totalRevenue ?? 0) * pff,
          enterpriseValue: (pf?.defaultKeyStatistics?.enterpriseValue ?? 0) * ppf,
          evRevenueMultiple: pf?.defaultKeyStatistics?.enterpriseValue && pf?.financialData?.totalRevenue
            ? pf.defaultKeyStatistics.enterpriseValue / (pf.financialData.totalRevenue * pff / ppf) : undefined,
          peRatio:         pf?.summaryDetail?.trailingPE         ?? null,
          pbRatio:         pf?.defaultKeyStatistics?.priceToBook ?? null,
          dividendYield:   pf?.summaryDetail?.dividendYield       ?? null,
          ebitda:          (pf?.financialData?.ebitda ?? 0) * pff,
          debtToEquity:    pf?.financialData?.debtToEquity    ?? null,
          profitMargin:    pf?.financialData?.profitMargins    ?? null,
          grossMargin:     pf?.financialData?.grossMargins     ?? null,
          operatingMargin: pf?.financialData?.operatingMargins ?? null,
          returnOnEquity:  pf?.financialData?.returnOnEquity   ?? null,
          returnOnAssets:  pf?.financialData?.returnOnAssets   ?? null,
          currentRatio:    pf?.financialData?.currentRatio     ?? null,
          sourceUrl: `https://finance.yahoo.com/quote/${peer.slug}`,
        };
      }));

      const finalPeers = peers
        .filter((p): p is NonNullable<typeof p> => p !== null && (p.marketCap ?? 0) > 0)
        .sort((a,b) => (b.marketCap??0) - (a.marketCap??0));

      await storage.createSearch({ ticker: full, exchange, startDate, endDate, beta: metrics.beta, peers: finalPeers as any });
      res.json({ ...target, peers: finalPeers });
    } catch (e) { console.error('[calculate]', e); res.status(500).json({ message: 'Internal server error' }); }
  });

  return httpServer;
}
