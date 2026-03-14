import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import YahooFinance from 'yahoo-finance2';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// YAHOO FINANCE — ONLY USE yf.historical() — confirmed working on Railway
// For index prices: fetch last 7 days, use last close
// For financials: quoteSummary (works if cookie auth succeeds, graceful if not)
// For news: RSS feeds (no auth needed, no IP restrictions)
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

async function tryAuth() {
  try { await (yf as any).validateCookies(); console.log('[Yahoo] Cookie auth ok'); }
  catch { console.log('[Yahoo] No cookie auth - historical() still works'); }
}
tryAuth();
setInterval(tryAuth, 20 * 60 * 1000);

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))]);
}

// Get current price via historical() - CONFIRMED working on Railway
async function getPrice(symbol: string): Promise<{ price: number; change: number; changePercent: number; prevClose: number } | null> {
  try {
    const end   = new Date();
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const data  = await withTimeout(
      yf.historical(symbol, { period1: start, period2: end, interval: '1d' }),
      12000
    );
    if (!data || data.length === 0) return null;
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : null;
    const change = prev ? last.close - prev.close : 0;
    return {
      price:         last.close,
      change,
      changePercent: prev ? (change / prev.close) * 100 : 0,
      prevClose:     prev?.close ?? last.close,
    };
  } catch { return null; }
}

// Financials - works when cookie auth succeeds, returns null gracefully otherwise
async function getFinancials(symbol: string): Promise<any | null> {
  try {
    return await withTimeout(
      yf.quoteSummary(symbol, {
        modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'assetProfile', 'price'] as any
      }),
      12000
    );
  } catch { return null; }
}

// News via RSS - financial/market focused feeds, no auth, no IP blocks
async function getNews(): Promise<any[]> {
  // Priority: market-moving news feeds only
  const feeds = [
    { url: 'https://economictimes.indiatimes.com/markets/stocks/rss.cms',  name: 'Economic Times' },
    { url: 'https://economictimes.indiatimes.com/markets/rss.cms',         name: 'Economic Times' },
    { url: 'https://www.business-standard.com/rss/markets-106.rss',        name: 'Business Standard' },
    { url: 'https://www.moneycontrol.com/rss/latestnews.xml',              name: 'Moneycontrol'   },
    { url: 'https://feeds.feedburner.com/ndtvprofit-latest',               name: 'NDTV Profit'    },
  ];

  // Market-relevant keywords — only keep news that could move markets
  const MARKET_KEYWORDS = [
    'nifty','sensex','rbi','sebi','rate','inflation','gdp','fed','rupee','crude',
    'earnings','profit','revenue','results','q1','q2','q3','q4','ipo','fii','dii',
    'market','stock','share','bse','nse','rally','fall','surge','drop','oil',
    'trade','tariff','budget','policy','interest','currency','dollar','export',
    'import','quarter','growth','economy','fiscal','monetary','index'
  ];

  const allNews: any[] = [];

  for (const feed of feeds) {
    try {
      const res = await withTimeout(
        fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/xml, application/xml, */*' } }),
        6000
      ) as Response | null;
      if (!res?.ok) continue;

      const xml   = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      if (!items.length) continue;

      for (const m of items.slice(0, 30)) {
        const it    = m[1];
        const title = (it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || it.match(/<title>(.*?)<\/title>/)?.[1] || '')
          .replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
        if (title.length < 10) continue;

        // Filter: only market-relevant news
        const titleLower = title.toLowerCase();
        const isRelevant = MARKET_KEYWORDS.some(kw => titleLower.includes(kw));
        if (!isRelevant) continue;

        const link = (it.match(/<link>(.*?)<\/link>/)?.[1] || it.match(/<guid>(.*?)<\/guid>/)?.[1] || '#').trim();
        const pub  = it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

        // Try to extract image from media:content, enclosure, or description
        const imgUrl = it.match(/<media:content[^>]+url="([^"]+)"/)?.[1]
                    || it.match(/<enclosure[^>]+url="([^"]+)"/)?.[1]
                    || it.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1]
                    || null;

        allNews.push({
          title,
          publisher:           feed.name,
          link,
          providerPublishTime: pub ? Math.floor(new Date(pub).getTime()/1000) : Math.floor(Date.now()/1000),
          thumbnail:           imgUrl,
        });
      }

      if (allNews.length >= 15) break; // enough from this feed
    } catch(e) {
      console.warn(`[News] ${feed.name} failed:`, (e as any)?.message);
    }
  }

  // Sort by most recent, deduplicate by title
  const seen = new Set<string>();
  return allNews
    .sort((a,b) => b.providerPublishTime - a.providerPublishTime)
    .filter(n => { const k = n.title.slice(0,50); if(seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 15);
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
    const h       = rows[0].map((x: any) => String(x ?? '').trim().toLowerCase());
    const nameIdx = h.findIndex(x => x.includes('company') || x === 'name');
    const tickIdx = h.findIndex(x => x.includes('ticker') || x === 'symbol');
    const indIdx  = h.findIndex(x => x === 'industry group' || x === 'industry');
    const secIdx  = h.findIndex(x => x === 'primary sector' || x === 'sector');
    if (tickIdx === -1) return;
    industryList = rows.slice(1).map(row => {
      const raw = String(row[tickIdx] ?? '').trim();
      return { symbol: raw.includes(':') ? raw.split(':')[1] : raw, name: nameIdx !== -1 ? String(row[nameIdx] ?? '').trim() : '', industry: indIdx !== -1 ? String(row[indIdx] ?? '').trim() : '', sector: secIdx !== -1 ? String(row[secIdx] ?? '').trim() : '' };
    }).filter(i => i.symbol.length > 0);
    console.log(`[Excel] ${industryList.length} companies`);
  } catch (e) { console.error('[Excel]', e); }
}
loadExcelData();

// ─────────────────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────────────────

function calcMetrics(s: number[], m: number[]) {
  if (s.length !== m.length || s.length < 10) return null;
  const sr: number[] = [], mr: number[] = [];
  for (let i=1;i<s.length;i++){sr.push((s[i]-s[i-1])/s[i-1]);mr.push((m[i]-m[i-1])/m[i-1]);}
  const n=sr.length,ms=sr.reduce((a,b)=>a+b,0)/n,mm=mr.reduce((a,b)=>a+b,0)/n;
  let cov=0,vm=0,vs=0;
  for(let i=0;i<n;i++){cov+=(sr[i]-ms)*(mr[i]-mm);vm+=(mr[i]-mm)**2;vs+=(sr[i]-ms)**2;}
  if(vm===0||vs===0) return null;
  const beta=cov/vm,alpha=ms-beta*mm,corr=cov/Math.sqrt(vs*vm);
  return {beta,alpha,correlation:corr,rSquared:corr**2,volatility:Math.sqrt(vs/(n-1))*Math.sqrt(252)};
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORICAL
// ─────────────────────────────────────────────────────────────────────────────

async function fetchHistory(ticker: string, start: string, end: string, retries = 3) {
  for (let i=1;i<=retries;i++) {
    try {
      const r = await withTimeout(yf.historical(ticker,{period1:new Date(start),period2:new Date(end),interval:'1d'}),18000);
      if (r && r.length > 0) return r;
    } catch(e:any){console.warn(`[hist] ${ticker} #${i}: ${e?.message}`);}
    if(i<retries) await new Promise(r=>setTimeout(r,i*1500));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PEERS — Excel-first, industry then sector fallback
// ─────────────────────────────────────────────────────────────────────────────

async function getPeers(ticker: string, exchange: string, exRate: number) {
  const sfx  = exchange === 'NSE' ? '.NS' : '.BO';
  const base = ticker.split('.')[0];
  const m    = industryList.find(i => i.symbol === base);
  if (!m) { console.log(`[Peers] ${base} not in Excel`); return []; }

  let peers = industryList.filter(i => i.industry === m.industry && i.symbol !== base);
  if (peers.length < 4 && m.sector) {
    console.log(`[Peers] ${base}: ${peers.length} → sector "${m.sector}"`);
    peers = industryList.filter(i => i.sector === m.sector && i.symbol !== base);
  }
  console.log(`[Peers] ${base} → ${peers.length} candidates`);

  // Get financials for market cap (works if cookie auth ok, null if not)
  const syms = peers.slice(0, 15).map(p => `${p.symbol}${sfx}`);
  const fins = await Promise.all(syms.map(s => getFinancials(s)));

  const results = [];
  for (let i=0;i<syms.length;i++) {
    const f = fins[i];
    const entry = industryList.find(x => x.symbol === syms[i].split('.')[0]);
    const cap = (f?.summaryDetail?.marketCap ?? 0) * (f?.financialData?.financialCurrency === 'USD' ? exRate : 1);
    results.push({ slug: syms[i], industry: entry?.industry ?? 'Unknown', sector: `${entry?.sector ?? 'Unknown'} > ${entry?.industry ?? 'Unknown'}`, marketCap: cap });
  }

  // Sort by market cap if available, otherwise keep Excel order
  return results.sort((a,b) => b.marketCap - a.marketCap).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', excelLoaded: industryList.length, uptime: process.uptime() }));
  app.get('/api/refresh-session', async (_req, res) => { await tryAuth(); res.json({ ok: true }); });

  // Diagnostic endpoints
  app.get('/api/test-quote/:symbol', async (req, res) => {
    const q = await getPrice(req.params.symbol);
    res.json(q ?? { error: 'no data' });
  });

  app.get('/api/test-historical/:symbol', async (req, res) => {
    try {
      const end   = new Date();
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const data  = await withTimeout(
        yf.historical(req.params.symbol, { period1: start, period2: end, interval: '1d' }),
        18000
      );
      res.json({ count: data?.length ?? 0, first: data?.[0] ?? null, last: data?.[data.length-1] ?? null });
    } catch(e: any) {
      res.json({ error: e?.message ?? 'unknown error' });
    }
  });

  app.get('/api/market/overview', async (_req, res) => {
    try {
      const [nifty, sensex, news] = await Promise.all([
        getPrice('^NSEI'),
        getPrice('^BSESN'),
        getNews(),
      ]);
      res.json({
        indices: {
          nifty50: nifty  ? { price: nifty.price,  change: nifty.change,  changePercent: nifty.changePercent,  prevClose: nifty.prevClose,  date: nifty.date  } : null,
          sensex:  sensex ? { price: sensex.price, change: sensex.change, changePercent: sensex.changePercent, prevClose: sensex.prevClose, date: sensex.date } : null,
        },
        news: news.slice(0, 12),
      });
    } catch(e){console.error('[overview]',e);res.status(500).json({message:'Failed'});}
  });

  app.post(api.beta.calculate.path, async (req, res) => {
    try {
      const { ticker, exchange, startDate, endDate, period } = api.beta.calculate.input.parse(req.body);
      const sfx   = exchange === 'NSE' ? '.NS' : '.BO';
      const mktTk = exchange === 'NSE' ? '^NSEI' : '^BSESN';
      const full  = ticker.endsWith(sfx) ? ticker : `${ticker}${sfx}`;

      const [mktData, stkData, fin, usdInr] = await Promise.all([
        fetchHistory(mktTk, startDate, endDate),
        fetchHistory(full,  startDate, endDate),
        getFinancials(full),
        getPrice('USDINR=X'),
      ]);

      if (!mktData?.length || !stkData?.length) {
        const detail = !mktData?.length ? `Market data (${mktTk}) empty` : `Stock data (${full}) empty`;
        console.error(`[calculate] Data fetch failed: ${detail}`);
        return res.status(404).json({ message: `Failed to fetch price data: ${detail}. Check the ticker symbol.` });
      }

      const dateMap = new Map<string,number>();
      mktData.forEach(d => { if(d?.close) dateMap.set(d.date.toISOString().split('T')[0], d.close); });
      const sp: number[]=[], mp: number[]=[];
      stkData.forEach(d => { const mv=dateMap.get(d.date.toISOString().split('T')[0]); if(mv&&d.close){sp.push(d.close);mp.push(mv);} });

      const metrics = calcMetrics(sp, mp);
      if (!metrics) return res.status(400).json({ message: 'Insufficient data points.' });

      const exRate = usdInr?.price ?? 83.5;
      const fCurr  = fin?.financialData?.financialCurrency ?? 'INR';
      const fFact  = fCurr === 'USD' ? exRate : 1;

      const target = {
        ticker: full, name: String(fin?.price?.longName ?? fin?.price?.shortName ?? ticker),
        marketIndex: exchange === 'NSE' ? 'NIFTY 50' : 'BSE SENSEX',
        industry: fin?.assetProfile?.industry ?? null, sector: fin?.assetProfile?.sector ?? null,
        exchange, ...metrics, period: period ?? '5Y', dataPoints: sp.length,
        marketCap:        (fin?.summaryDetail?.marketCap ?? 0) * fFact,
        revenue:          (fin?.financialData?.totalRevenue ?? 0) * fFact,
        enterpriseValue:  (fin?.defaultKeyStatistics?.enterpriseValue ?? 0) * fFact,
        evRevenueMultiple: fin?.defaultKeyStatistics?.enterpriseValue && fin?.financialData?.totalRevenue ? fin.defaultKeyStatistics.enterpriseValue/(fin.financialData.totalRevenue*fFact) : undefined,
        peRatio:         fin?.summaryDetail?.trailingPE ?? null,
        pbRatio:         fin?.defaultKeyStatistics?.priceToBook ?? null,
        dividendYield:   fin?.summaryDetail?.dividendYield ?? null,
        ebitda:          (fin?.financialData?.ebitda ?? 0) * fFact,
        debtToEquity:    fin?.financialData?.debtToEquity ?? null,
        profitMargin:    fin?.financialData?.profitMargins ?? null,
        grossMargin:     fin?.financialData?.grossMargins ?? null,
        operatingMargin: fin?.financialData?.operatingMargins ?? null,
        returnOnEquity:  fin?.financialData?.returnOnEquity ?? null,
        returnOnAssets:  fin?.financialData?.returnOnAssets ?? null,
        currentRatio:    fin?.financialData?.currentRatio ?? null,
        sourceUrl: `https://finance.yahoo.com/quote/${full}`,
      };

      const peerList = await getPeers(full, exchange, exRate);
      const peers = await Promise.all(peerList.map(async peer => {
        const [pd, pf] = await Promise.all([fetchHistory(peer.slug, startDate, endDate), getFinancials(peer.slug)]);
        if (!pd || pd.length < 10) return null;
        const ps: number[]=[], pm: number[]=[];
        pd.forEach(d => { const mv=dateMap.get(d.date.toISOString().split('T')[0]); if(mv&&d.close){ps.push(d.close);pm.push(mv);} });
        const pm2 = calcMetrics(ps, pm);
        const pfcurr = pf?.financialData?.financialCurrency ?? 'INR';
        const pff = pfcurr === 'USD' ? exRate : 1;
        return {
          ticker: peer.slug, name: pf?.price?.shortName ?? peer.slug,
          industry: peer.industry, sector: peer.sector,
          beta: pm2?.beta??null, volatility: pm2?.volatility??null, alpha: pm2?.alpha??null, correlation: pm2?.correlation??null, rSquared: pm2?.rSquared??null,
          marketCap:       (pf?.summaryDetail?.marketCap??0)*pff,
          revenue:         (pf?.financialData?.totalRevenue??0)*pff,
          enterpriseValue: (pf?.defaultKeyStatistics?.enterpriseValue??0)*pff,
          evRevenueMultiple: pf?.defaultKeyStatistics?.enterpriseValue && pf?.financialData?.totalRevenue ? pf.defaultKeyStatistics.enterpriseValue/(pf.financialData.totalRevenue*pff) : undefined,
          peRatio: pf?.summaryDetail?.trailingPE??null, pbRatio: pf?.defaultKeyStatistics?.priceToBook??null,
          dividendYield: pf?.summaryDetail?.dividendYield??null, ebitda: (pf?.financialData?.ebitda??0)*pff,
          debtToEquity: pf?.financialData?.debtToEquity??null, profitMargin: pf?.financialData?.profitMargins??null,
          grossMargin: pf?.financialData?.grossMargins??null, operatingMargin: pf?.financialData?.operatingMargins??null,
          returnOnEquity: pf?.financialData?.returnOnEquity??null, returnOnAssets: pf?.financialData?.returnOnAssets??null,
          currentRatio: pf?.financialData?.currentRatio??null,
          sourceUrl: `https://finance.yahoo.com/quote/${peer.slug}`,
        };
      }));

      const finalPeers = peers.filter((p): p is NonNullable<typeof p> => p !== null).sort((a,b)=>(b.marketCap??0)-(a.marketCap??0));
      await storage.createSearch({ ticker: full, exchange, startDate, endDate, beta: metrics.beta, peers: finalPeers as any });
      res.json({ ...target, peers: finalPeers });
    } catch(e){console.error('[calculate]',e);res.status(500).json({message:'Internal server error'});}
  });

  return httpServer;
}
