import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView, useMotionValue, useSpring } from "framer-motion";
import { type CalculateBetaResponse } from "@shared/schema";
import {
  TrendingUp, TrendingDown, Minus, Info, Download, Settings2,
  Activity, BarChart2, Target, Layers, Zap, ExternalLink, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props { data: CalculateBetaResponse; }

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 900, bounce: 0 });
  const inView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(fmt(0));
  useEffect(() => { if (inView) mv.set(value); }, [inView, value]);
  useEffect(() => { return spring.on("change", v => setDisplay(fmt(v))); }, [spring, fmt]);
  return <span ref={ref}>{display}</span>;
}

// ── Full metric definitions ───────────────────────────────────────────────────
const METRIC_DEFS: Record<string, { full: string; short: string; def: string; category: string; fmt: (v: number) => string }> = {
  marketCap:       { full: "Market Capitalisation",         short: "Mkt Cap",     def: "Total market value of all outstanding shares of the company.",                                                       category: "Size",      fmt: v => `₹${(v/1e7).toLocaleString('en-IN',{maximumFractionDigits:0})} Cr` },
  revenue:         { full: "Total Revenue (TTM)",            short: "Revenue",     def: "Total income generated from business operations over the trailing 12 months.",                                       category: "Size",      fmt: v => `₹${(v/1e7).toLocaleString('en-IN',{maximumFractionDigits:0})} Cr` },
  enterpriseValue: { full: "Enterprise Value",               short: "EV",          def: "Market Cap + Total Debt − Cash. Represents the theoretical takeover price.",                                         category: "Size",      fmt: v => `₹${(v/1e7).toLocaleString('en-IN',{maximumFractionDigits:0})} Cr` },
  ebitda:          { full: "EBITDA (TTM)",                   short: "EBITDA",      def: "Earnings Before Interest, Taxes, Depreciation and Amortisation. Proxy for operating cash flow.",                    category: "Size",      fmt: v => `₹${(v/1e7).toLocaleString('en-IN',{maximumFractionDigits:0})} Cr` },
  evRevenueMultiple:{ full: "EV / Revenue Multiple",         short: "EV/Rev",      def: "Enterprise Value divided by Revenue. Lower = relatively cheaper on a sales basis.",                                  category: "Valuation", fmt: v => `${v.toFixed(2)}x` },
  peRatio:         { full: "Price-to-Earnings Ratio (P/E)",  short: "P/E",         def: "Share price divided by earnings per share. How much investors pay per ₹1 of profit.",                               category: "Valuation", fmt: v => `${v.toFixed(1)}x` },
  pbRatio:         { full: "Price-to-Book Ratio (P/B)",      short: "P/B",         def: "Share price divided by book value per share. <1 may indicate undervaluation.",                                       category: "Valuation", fmt: v => `${v.toFixed(2)}x` },
  dividendYield:   { full: "Dividend Yield",                 short: "Div Yield",   def: "Annual dividend per share as a percentage of the share price.",                                                       category: "Income",    fmt: v => `${(v*100).toFixed(2)}%` },
  profitMargin:    { full: "Net Profit Margin",              short: "Net Margin",  def: "Net income as a percentage of revenue. Higher = more of each rupee of sales converted to profit.",                   category: "Margins",   fmt: v => `${(v*100).toFixed(1)}%` },
  grossMargin:     { full: "Gross Profit Margin",            short: "Gross Margin",def: "Revenue minus cost of goods sold, as a percentage of revenue.",                                                       category: "Margins",   fmt: v => `${(v*100).toFixed(1)}%` },
  operatingMargin: { full: "Operating Profit Margin",        short: "Op. Margin",  def: "Earnings from operations as a percentage of revenue. Excludes interest and tax.",                                    category: "Margins",   fmt: v => `${(v*100).toFixed(1)}%` },
  returnOnEquity:  { full: "Return on Equity (ROE)",         short: "ROE",         def: "Net income as a percentage of shareholders' equity. Measures how efficiently equity is deployed.",                   category: "Returns",   fmt: v => `${(v*100).toFixed(1)}%` },
  returnOnAssets:  { full: "Return on Assets (ROA)",         short: "ROA",         def: "Net income as a percentage of total assets. Measures asset utilisation efficiency.",                                 category: "Returns",   fmt: v => `${(v*100).toFixed(1)}%` },
  debtToEquity:    { full: "Debt-to-Equity Ratio (D/E)",     short: "D/E",         def: "Total liabilities divided by shareholders' equity. Higher = more leverage and financial risk.",                      category: "Risk",      fmt: v => `${v.toFixed(2)}x` },
  currentRatio:    { full: "Current Ratio",                  short: "Curr. Ratio", def: "Current assets divided by current liabilities. >1 means company can cover short-term obligations.",                 category: "Risk",      fmt: v => `${v.toFixed(2)}x` },
  volatility:      { full: "Annualised Volatility",          short: "Volatility",  def: "Annualised standard deviation of daily returns. Measures how much the stock price fluctuates.",                      category: "Beta/Risk", fmt: v => `${(v*100).toFixed(1)}%` },
  rSquared:        { full: "R² (Coefficient of Determination)", short: "R²",       def: "Proportion of the stock's movement explained by the benchmark index. Range 0–1.",                                    category: "Beta/Risk", fmt: v => v.toFixed(3) },
};

const CATEGORY_ORDER = ["Size", "Valuation", "Income", "Margins", "Returns", "Risk", "Beta/Risk"];

const ALL_METRIC_IDS = Object.keys(METRIC_DEFS);
const DEFAULT_VISIBLE = ["marketCap", "revenue", "enterpriseValue", "evRevenueMultiple", "peRatio", "pbRatio", "profitMargin", "debtToEquity", "volatility"];

// ── Tooltip helper ────────────────────────────────────────────────────────────
function MetricTip({ id }: { id: string }) {
  const def = METRIC_DEFS[id];
  if (!def) return null;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="ml-1 text-white/45 hover:text-primary transition-colors"><Info className="w-3 h-3" /></button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] p-3 bg-card border-border">
          <p className="text-[9px] font-mono text-primary uppercase tracking-wider mb-1 font-semibold">{def.full}</p>
          <p className="text-[10px] text-white/70 leading-relaxed">{def.def}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Beta config ───────────────────────────────────────────────────────────────
function getBetaCfg(beta: number | null) {
  if (beta === null) return { label: "N/A",        color: "text-white/60",   bg: "bg-white/4",         Icon: Minus };
  if (beta > 1.2)    return { label: "Aggressive", color: "text-red-400",    bg: "bg-red-500/8",       Icon: TrendingUp };
  if (beta < 0.8)    return { label: "Defensive",  color: "text-emerald-400",bg: "bg-emerald-500/8",   Icon: TrendingDown };
                     return { label: "Neutral",    color: "text-primary",    bg: "bg-primary/8",       Icon: Minus };
}

const fmt = (id: string, v: number) => METRIC_DEFS[id]?.fmt(v) ?? String(v);
const val = (obj: any, id: string) => (obj[id] !== undefined && obj[id] !== null) ? obj[id] : null;

const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const up = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } } };

export function ResultsSection({ data }: Props) {
  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE);
  const toggle = (id: string) => setVisible(p => p.includes(id) ? p.filter(m => m !== id) : [...p, id]);

  const exportCSV = () => {
    const cols = ALL_METRIC_IDS.filter(id => visible.includes(id));
    const hdr = ["#", "Company", "Ticker", "Industry", "Beta", "Alpha", ...cols.map(id => METRIC_DEFS[id].short)];
    const row = (obj: any, idx: number | string) => [
      String(idx),
      obj.name || obj.ticker,
      obj.ticker,
      obj.industry || obj.sector?.split(" > ")[1] || "—",
      obj.beta !== null ? Number(obj.beta).toFixed(3) : "—",
      obj.alpha !== null ? Number(obj.alpha).toFixed(5) : "—",
      ...cols.map(id => val(obj, id) !== null ? METRIC_DEFS[id].fmt(val(obj, id)!).replace(/[₹,]/g, '') : "—")
    ];
    const csv = [hdr, row(data, 0), ...data.peers.map((p, i) => row(p, i + 1))].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `akaldeep_${data.ticker}_${new Date().toISOString().slice(0,10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const validBetas = data.peers.map(p => p.beta).filter((b): b is number => b !== null);
  const avgBeta = validBetas.length ? validBetas.reduce((a, b) => a + b, 0) / validBetas.length : null;
  const sortedB = [...validBetas].sort((a, b) => a - b);
  const mid = Math.floor(sortedB.length / 2);
  const medianBeta = sortedB.length === 0 ? null : sortedB.length % 2 !== 0 ? sortedB[mid] : (sortedB[mid-1] + sortedB[mid]) / 2;
  const betaCfg = getBetaCfg(data.beta);
  const BetaIcon = betaCfg.Icon;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">

      {/* ── LIVE CALCULATION FEATURE CALLOUT ───────────────────────────── */}
      <motion.div variants={up}>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-xs font-mono text-primary uppercase tracking-widest font-semibold">Live Calculation Engine</span>
          </div>
          <div className="flex flex-wrap gap-4 text-[10px] font-mono text-white/60">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Beta computed from <span className="text-white/90">{data.dataPoints?.toLocaleString() ?? "—"} daily price observations</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.3s" }} />
              Volatility annualised via <span className="text-white/90">√252 scaling</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0.6s" }} />
              Regression against <span className="text-white/90">{data.marketIndex}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: "0.9s" }} />
              Currency conversion at <span className="text-white/90">live USD/INR rate</span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── PRIMARY CARD ───────────────────────────────────────────────── */}
      <motion.div variants={up} className="card-premium">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="text-[9px] font-mono text-white/55 uppercase tracking-[0.18em]">Primary Asset Analysis</span>
          </div>
          <a href={data.sourceUrl || `https://finance.yahoo.com/quote/${data.ticker}`} target="_blank" rel="noopener noreferrer"
            className="text-[9px] font-mono text-white/45 hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
            {data.ticker} <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="p-5 space-y-5">
          {/* Company identity + beta hero */}
          <div className="flex flex-col lg:flex-row lg:items-start gap-5">
            <div className="flex-1 space-y-2">
              <h2 className="font-display text-4xl text-white/90 leading-none tracking-wide">
                {(data.name || data.ticker).toUpperCase()}
              </h2>
              {/* Industry / sector tags */}
              <div className="flex flex-wrap items-center gap-2">
                {data.sector && (
                  <span className="flex items-center gap-1 text-[9px] font-mono text-white/55 bg-white/5 border border-white/8 px-2 py-0.5 rounded">
                    <Building2 className="w-2.5 h-2.5" /> {data.sector}
                  </span>
                )}
                {data.industry && (
                  <span className="text-[9px] font-mono text-primary/70 bg-primary/8 border border-primary/15 px-2 py-0.5 rounded">
                    {data.industry}
                  </span>
                )}
                <span className="text-[9px] font-mono text-white/45 bg-white/4 border border-white/6 px-2 py-0.5 rounded">
                  {data.exchange} · {data.marketIndex}
                </span>
                <span className="text-[9px] font-mono text-white/45 bg-white/4 border border-white/6 px-2 py-0.5 rounded">
                  {data.period ?? "5Y"} Daily
                </span>
              </div>
            </div>

            {/* Beta hero */}
            <div className={`flex items-center gap-4 px-5 py-4 rounded-lg border border-white/8 ${betaCfg.bg} shrink-0`}>
              <div className={`font-display text-7xl leading-none tracking-tight ${betaCfg.color} metric-glow`}>
                {data.beta.toFixed(3)}
              </div>
              <div className="space-y-1">
                <div className={`flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest ${betaCfg.color}`}>
                  <BetaIcon className="w-3.5 h-3.5" /> {betaCfg.label}
                </div>
                <div className="text-[9px] font-mono text-white/50 uppercase tracking-wider">Beta Coefficient</div>
                <div className="text-[9px] font-mono text-white/45">
                  R² {data.rSquared ? data.rSquared.toFixed(3) : "—"} · ρ {data.correlation ? data.correlation.toFixed(3) : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* ── FULL METRICS GRID grouped by category ── */}
          {CATEGORY_ORDER.map(cat => {
            const metricsInCat = ALL_METRIC_IDS.filter(id => METRIC_DEFS[id].category === cat && val(data, id) !== null);
            if (!metricsInCat.length) return null;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-mono text-white/45 uppercase tracking-[0.2em]">{cat}</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                  {metricsInCat.map(id => {
                    const v = val(data, id);
                    const def = METRIC_DEFS[id];
                    return (
                      <div key={id} className="bg-white/[0.03] rounded border border-white/6 px-3 py-2.5 hover:border-primary/20 transition-colors group">
                        <div className="flex items-center text-[8px] font-mono text-white/55 uppercase tracking-wider mb-1.5">
                          {def.short} <MetricTip id={id} />
                        </div>
                        <div className="font-mono text-sm font-medium text-white/80 tabular-nums">
                          {def.fmt(v!)}
                        </div>
                        <div className="text-[7px] font-mono text-white/15 mt-0.5 truncate">{def.full}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── INDUSTRY BENCHMARK ─────────────────────────────────────────── */}
      <motion.div variants={up} className="card-premium">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-[9px] font-mono text-white/55 uppercase tracking-[0.18em]">Industry Benchmark</span>
          </div>
          {data.industry && (
            <span className="text-[9px] font-mono text-primary/60 bg-primary/8 border border-primary/15 px-2 py-0.5 rounded uppercase tracking-wider">
              {data.industry}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {[{ label: "Average Beta", v: avgBeta }, { label: "Median Beta", v: medianBeta }].map(({ label, v }) => (
            <div key={label} className="p-8 flex flex-col items-center gap-2">
              <span className="text-[9px] font-mono text-white/50 uppercase tracking-[0.18em]">{label}</span>
              <div className="font-display text-5xl text-white/80">{v !== null ? v.toFixed(3) : "—"}</div>
              {v !== null && (
                <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${data.beta > v ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                  Target is {data.beta > v ? "above" : "below"} {label.split(" ")[0].toLowerCase()}
                </span>
              )}
              <span className="text-[8px] font-mono text-white/45">{data.peers.length} peers</span>
            </div>
          ))}
        </div>

        {/* Beta distribution strip */}
        {validBetas.length > 0 && (() => {
          const mn = Math.min(...validBetas, data.beta) - 0.1;
          const mx = Math.max(...validBetas, data.beta) + 0.1;
          const pct = (v: number) => ((v - mn) / (mx - mn)) * 100;
          return (
            <div className="px-5 pb-4 pt-2 border-t border-border">
              <div className="flex justify-between mb-1.5">
                <span className="text-[8px] font-mono text-white/45 uppercase tracking-wider">Peer Beta Distribution</span>
                <span className="text-[8px] font-mono text-white/45">{Math.min(...validBetas).toFixed(2)} — {Math.max(...validBetas).toFixed(2)}</span>
              </div>
              <div className="relative h-2 bg-white/5 rounded-full overflow-visible">
                {validBetas.map((b, i) => (
                  <motion.div key={i} className="absolute top-0 w-0.5 h-full bg-white/20 rounded-full"
                    style={{ left: `${pct(b)}%` }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.04 }} />
                ))}
                <motion.div className="absolute -top-0.5 w-1.5 h-3 bg-primary rounded-full z-10 shadow-[0_0_6px_hsl(38,92%,50%)]"
                  style={{ left: `${pct(data.beta)}%`, translateX: "-50%" }}
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.5, type: "spring" }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[7px] font-mono text-white/15">Defensive</span>
                <span className="text-[7px] font-mono text-primary/50">▲ {data.ticker.split('.')[0]}</span>
                <span className="text-[7px] font-mono text-white/15">Aggressive</span>
              </div>
            </div>
          );
        })()}
      </motion.div>

      {/* ── PEER TABLE ──────────────────────────────────────────────────── */}
      <motion.div variants={up} className="card-premium">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-primary" />
            <span className="text-[9px] font-mono text-white/55 uppercase tracking-[0.18em]">Peer Comparables</span>
            <span className="text-[9px] font-mono text-white/45 bg-white/5 px-1.5 py-0.5 rounded">{data.peers.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-[9px] font-mono uppercase tracking-wider gap-1.5 border-white/10 bg-transparent text-white/50 hover:bg-white/5">
                  <Settings2 className="w-3 h-3" /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                {CATEGORY_ORDER.map(cat => {
                  const ids = ALL_METRIC_IDS.filter(id => METRIC_DEFS[id].category === cat);
                  if (!ids.length) return null;
                  return (
                    <div key={cat}>
                      <DropdownMenuLabel className="text-[8px] font-mono uppercase tracking-widest text-white/55">{cat}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {ids.map(id => (
                        <DropdownMenuCheckboxItem key={id} checked={visible.includes(id)} onCheckedChange={() => toggle(id)} className="text-xs font-mono">
                          <span className="font-semibold">{METRIC_DEFS[id].short}</span>
                          <span className="ml-2 text-white/55 text-[9px]">— {METRIC_DEFS[id].full}</span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </div>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={exportCSV} className="h-7 text-[9px] font-mono uppercase tracking-wider gap-1.5 border-white/10 bg-transparent text-white/50 hover:bg-white/5">
              <Download className="w-3 h-3" /> CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="premium-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-8 pl-5 py-3 text-[8px] font-mono uppercase tracking-widest text-white/45">#</TableHead>
                <TableHead className="min-w-[180px] py-3 text-[8px] font-mono uppercase tracking-widest text-white/45">Company</TableHead>
                <TableHead className="text-right py-3 text-[8px] font-mono uppercase tracking-widest text-white/45 whitespace-nowrap">
                  Beta <span className="text-[7px] text-white/15 normal-case font-normal">(β)</span>
                </TableHead>
                <TableHead className="text-right py-3 text-[8px] font-mono uppercase tracking-widest text-white/45 whitespace-nowrap">
                  Alpha <span className="text-[7px] text-white/15 normal-case font-normal">(α)</span>
                </TableHead>
                {ALL_METRIC_IDS.filter(id => visible.includes(id)).map(id => (
                  <TableHead key={id} className="text-right py-3 text-[8px] font-mono uppercase tracking-widest text-white/45 whitespace-nowrap">
                    {METRIC_DEFS[id].short}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.peers.map((peer, idx) => {
                const cfg = getBetaCfg(peer.beta);
                const PeerIcon = cfg.Icon;
                return (
                  <motion.tr key={peer.ticker}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="border-b border-border/40 last:border-0 hover:bg-white/[0.025] transition-colors"
                  >
                    <TableCell className="pl-5 py-3.5 font-mono text-[9px] text-white/45 tabular-nums">{idx + 1}</TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <a href={peer.sourceUrl || `https://finance.yahoo.com/quote/${peer.ticker}`} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-semibold text-white/80 hover:text-primary transition-colors leading-tight flex items-center gap-1 group">
                          {peer.name}
                          <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[9px] text-white/50 uppercase tracking-wider">{peer.ticker}</span>
                          {peer.industry && (
                            <span className="text-[7px] font-mono px-1 py-px bg-primary/8 border border-primary/15 rounded text-primary/50 uppercase tracking-wide">
                              {peer.industry}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right py-3.5">
                      <span className={`font-mono text-sm font-semibold tabular-nums ${cfg.color}`}>
                        {peer.beta !== null ? peer.beta.toFixed(3) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right py-3.5">
                      <span className="font-mono text-xs text-white/55 tabular-nums">
                        {peer.alpha !== null && peer.alpha !== undefined ? Number(peer.alpha).toFixed(5) : "—"}
                      </span>
                    </TableCell>
                    {ALL_METRIC_IDS.filter(id => visible.includes(id)).map(id => {
                      const v = val(peer, id);
                      return (
                        <TableCell key={id} className="text-right py-3.5">
                          <span className="font-mono text-xs text-white/60 tabular-nums whitespace-nowrap">
                            {v !== null ? METRIC_DEFS[id].fmt(v) : "—"}
                          </span>
                        </TableCell>
                      );
                    })}
                  </motion.tr>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="px-5 py-3 border-t border-border bg-white/[0.01] flex flex-wrap items-center justify-between gap-3">
          <p className="text-[8px] font-mono text-white/45 leading-relaxed">
            All financials: TTM where applicable · Non-INR converted at live Yahoo Finance FX rate · Peers deduplicated by base symbol, normalised to {data.exchange} exchange · Sorted by market cap
          </p>
          <p className="text-[8px] font-mono text-white/15 shrink-0">
            Source: Yahoo Finance · Damodaran Classification
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
