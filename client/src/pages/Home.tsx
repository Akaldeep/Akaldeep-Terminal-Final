import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, subYears, startOfDay } from "date-fns";
import { CalendarIcon, Loader2, Search, TrendingUp, TrendingDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";

import { useCalculateBeta } from "@/hooks/use-beta";
import { ResultsSection } from "@/components/ResultsSection";
import { WorldMap } from "@/components/WorldMap";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface IndexData { price: number; change: number; changePercent: number; prevClose?: number; }
interface NewsItem { title: string; publisher: string; link: string; providerPublishTime: number; thumbnail?: string | null; }
interface MarketOverview {
  indices: { nifty50: IndexData | null; sensex: IndexData | null };
  news: NewsItem[];
}

const formSchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  exchange: z.enum(["NSE", "BSE"]),
  period: z.enum(["1Y", "3Y", "5Y"]),
  endDate: z.date(),
});
type FormValues = z.infer<typeof formSchema>;

function IndexBadge({ label, data }: { label: string; data: IndexData | null }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  if (!data) return (
    <div className="flex items-center gap-2 px-3 py-2 rounded bg-white/6 border border-white/12">
      <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider font-semibold">{label}</span>
      <div className="w-16 h-3 bg-white/10 rounded animate-pulse" />
    </div>
  );
  const up = data.change >= 0;
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-4 py-2 rounded bg-white/6 border border-white/12 hover:border-primary/40 transition-colors">
      <div className="flex flex-col">
        <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider font-semibold">{label}</span>
        <span className="text-[9px] font-mono text-white/35">{dateStr} · {timeStr}</span>
      </div>
      <span className="font-mono text-base font-bold text-white">
        {data.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </span>
      <span className={`flex items-center gap-0.5 text-[11px] font-mono font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
        {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        {up ? "+" : ""}{data.changePercent?.toFixed(2)}%
      </span>
    </motion.div>
  );
}

function FloatingNewsColumn({ items, side }: { items: NewsItem[]; side: "left" | "right" }) {
  if (!items.length) return null;
  const doubled = [...items, ...items];
  return (
    <div className={`absolute top-0 bottom-0 w-56 overflow-hidden pointer-events-none z-20
      ${side === "left" ? "left-0" : "right-0"}`}>
      <div className="absolute inset-x-0 top-0 h-20 z-10 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-20 z-10 bg-gradient-to-t from-background to-transparent" />
      <motion.div className={`flex flex-col gap-2.5 py-6 ${side === "left" ? "px-3 pr-2" : "px-3 pl-2"}`}
        animate={{ y: [0, -(items.length * 110)] }}
        transition={{ duration: items.length * 12, repeat: Infinity, ease: "linear" }}>
        {doubled.map((item, i) => (
          <div key={i} className="rounded border border-white/8 bg-white/[0.04] overflow-hidden" style={{ opacity: 0.82 }}>
            {item.thumbnail && (
              <div className="w-full h-24 overflow-hidden bg-white/5">
                <img
                  src={item.thumbnail}
                  alt=""
                  className="w-full h-full object-cover opacity-80"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
            <div className="p-2.5 space-y-1">
              <p className="text-[9px] font-mono text-white/85 leading-snug line-clamp-3">{item.title}</p>
              <p className="text-[8px] font-mono text-white/55 uppercase tracking-wider">{item.publisher}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

function NewsTicker({ items }: { items: NewsItem[] }) {
  if (!items.length) return null;
  const rep = [...items, ...items];
  return (
    <div className="w-full overflow-hidden border-y border-white/5 bg-black/20">
      <div className="flex items-center">
        <div className="shrink-0 px-3 py-2 bg-primary/10 border-r border-primary/20 flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-mono text-primary uppercase tracking-widest font-bold">LIVE</span>
          <span className="text-[8px] font-mono text-primary/60 uppercase tracking-widest">NEWS</span>
        </div>
        <div className="overflow-hidden flex-1">
          <motion.div className="flex items-center gap-6 py-1.5 px-4"
            style={{ width: "max-content" }}
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: items.length * 10, repeat: Infinity, ease: "linear" }}>
            {rep.map((item, i) => (
              <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 shrink-0 hover:opacity-100 opacity-90 transition-opacity pointer-events-auto group">
                {item.thumbnail && (
                  <div className="w-8 h-8 rounded overflow-hidden bg-white/10 flex-shrink-0">
                    <img src={item.thumbnail} alt="" className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }} />
                  </div>
                )}
                <span className="text-[10px] font-mono text-white/75 group-hover:text-white/95 transition-colors max-w-xs truncate">
                  <span className="text-primary/50 mr-2">◆</span>
                  {item.title}
                </span>
                <span className="text-[9px] font-mono text-primary/60 shrink-0">{item.publisher}</span>
                <span className="text-white/20 mx-1">|</span>
              </a>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

const STAGES = [
  "Fetching historical price data…",
  "Running beta regression model…",
  "Identifying peer comparables…",
  "Converting financials to INR…",
  "Computing valuation multiples…",
  "Finalising output…",
];

function AnalysisLoader() {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const s = setInterval(() => setStage(p => Math.min(p + 1, STAGES.length - 1)), 1800);
    const p = setInterval(() => setProgress(p => Math.min(p + 1.5, 95)), 100);
    return () => { clearInterval(s); clearInterval(p); };
  }, []);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-5 py-14">
      <div className="relative w-14 h-14">
        <motion.div className="absolute inset-0 rounded-full border border-primary/20" animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }} />
        <motion.div className="absolute inset-0 rounded-full border-t-2 border-primary" animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-primary/50" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <AnimatePresence mode="wait">
          <motion.p key={stage} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="font-mono text-sm text-white/45 tracking-wide">{STAGES[stage]}</motion.p>
        </AnimatePresence>
        <p className="font-mono text-[10px] text-white/20 tracking-widest uppercase">{Math.round(progress)}%</p>
      </div>
      <div className="w-44 h-px bg-white/8 overflow-hidden rounded-full">
        <motion.div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
      </div>
    </motion.div>
  );
}

export default function Home() {
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [mapZoomed, setMapZoomed] = useState(false);
  const [companyName, setCompanyName] = useState<string>();
  const { mutate, isPending, data, error, reset: resetMutation } = useCalculateBeta();

  const { data: marketData } = useQuery<MarketOverview>({
    queryKey: ["market-overview"],
    queryFn: async () => {
      const res = await fetch("/api/market/overview");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { ticker: "", exchange: "NSE", period: "5Y", endDate: new Date() },
  });

  const onSubmit = (values: FormValues) => {
    setHasAnalyzed(false);
    resetMutation();
    setMapZoomed(true);
    const end = startOfDay(values.endDate);
    const start = subYears(end, parseInt(values.period[0]));
    mutate(
      { ticker: values.ticker.toUpperCase(), exchange: values.exchange, period: values.period, startDate: start.toISOString(), endDate: end.toISOString() },
      { onSuccess: (result) => { setCompanyName((result as any).name || values.ticker); setHasAnalyzed(true); } }
    );
  };

  const news = marketData?.news || [];

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* HERO + MAP */}
      <div className="relative w-full" style={{ height: "72vh", minHeight: 500 }}>

        {/* Full-bleed world map */}
        <div className="absolute inset-0">
          <WorldMap zoomed={mapZoomed} analyzing={isPending} companyName={companyName} exchange={form.watch("exchange")} />
        </div>

        {/* Ghost news columns — left and right */}
        <FloatingNewsColumn items={news.slice(0, 6)} side="left" />
        <FloatingNewsColumn items={news.slice(6, 12)} side="right" />

        {/* Hero headline — fades out when results appear */}
        <AnimatePresence>
          {!hasAnalyzed && !isPending && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.5 }}
              className="absolute top-10 inset-x-0 flex flex-col items-center z-20 pointer-events-none px-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="h-px w-5 bg-primary/50" />
                <span className="text-[10px] font-mono text-primary/75 uppercase tracking-[0.25em] font-medium">Indian Equity Analytics</span>
                <span className="h-px w-5 bg-primary/50" />
              </div>
              <h1 className="font-display text-5xl md:text-6xl lg:text-8xl text-white/90 text-center leading-none tracking-wide">INSTITUTIONAL</h1>
              <h1 className="font-display text-5xl md:text-6xl lg:text-8xl text-center leading-none tracking-wide gold-shimmer">RISK INTELLIGENCE</h1>
              <p className="mt-4 text-xs font-mono text-white/50 text-center max-w-md leading-relaxed">
                Beta regression · peer discovery · valuation multiples<br />
                4,700+ listed Indian equities · Damodaran classification
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom: indices + form */}
        <div className="absolute inset-x-0 bottom-0 z-30">
          <div className="flex items-center justify-center gap-3 pb-3 px-4">
            <IndexBadge label="NIFTY 50" data={marketData?.indices?.nifty50 ?? null} />
            <div className="w-px h-4 bg-white/10" />
            <IndexBadge label="SENSEX" data={marketData?.indices?.sensex ?? null} />
          </div>

          <div className="mx-auto max-w-4xl px-4 pb-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-lg border border-white/10 bg-black/65 backdrop-blur-xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/6">
                <motion.div className="w-1.5 h-1.5 rounded-full bg-primary"
                  animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
                <span className="text-[10px] font-mono text-white/60 uppercase tracking-[0.2em] font-medium">
                  Analysis Configuration
                </span>
              </div>
              <div className="p-4">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-wrap gap-3 items-end">
                    <FormField control={form.control} name="ticker" render={({ field }) => (
                      <FormItem className="min-w-[140px] flex-1 space-y-1">
                        <FormLabel className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/55 font-medium">Stock Ticker</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-white/20" />
                            <Input placeholder="RELIANCE" className="pl-7 h-8 font-mono text-sm uppercase bg-white/5 border-white/10 text-white placeholder:text-white/35 focus:border-primary/50 focus-visible:ring-0 transition-all" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="exchange" render={({ field }) => (
                      <FormItem className="min-w-[95px] space-y-1">
                        <FormLabel className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/55 font-medium">Exchange</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-8 font-mono text-sm bg-white/5 border-white/10 text-white focus:ring-0 focus:border-primary/50">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="NSE" className="font-mono">NSE</SelectItem>
                            <SelectItem value="BSE" className="font-mono">BSE</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="period" render={({ field }) => (
                      <FormItem className="min-w-[125px] space-y-1">
                        <FormLabel className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/55 font-medium">Period</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-8 font-mono text-sm bg-white/5 border-white/10 text-white focus:ring-0 focus:border-primary/50">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1Y" className="font-mono">1 Year Daily</SelectItem>
                            <SelectItem value="3Y" className="font-mono">3 Year Daily</SelectItem>
                            <SelectItem value="5Y" className="font-mono">5 Year Daily</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="endDate" render={({ field }) => (
                      <FormItem className="min-w-[145px] flex-1 space-y-1">
                        <FormLabel className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/55 font-medium">End Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant="outline" className={cn("w-full h-8 justify-start font-mono text-sm bg-white/5 border-white/10 text-white hover:bg-white/8 hover:text-white", !field.value && "text-white/15")}>
                                <CalendarIcon className="mr-2 h-3 w-3 text-white/20" />
                                {field.value ? format(field.value, "dd MMM yyyy") : "Select date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(d) => d > new Date()} initialFocus />
                          </PopoverContent>
                        </Popover>
                      </FormItem>
                    )} />

                    <Button type="submit" disabled={isPending}
                      className="h-8 px-5 bg-primary hover:bg-primary/90 text-black font-mono text-[11px] uppercase tracking-[0.15em] font-bold active:scale-[0.97] gap-1.5 shrink-0 transition-all">
                      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "ANALYSE →"}
                    </Button>
                  </form>
                </Form>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* News ticker strip */}
      <NewsTicker items={news} />

      {/* Results */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <AnimatePresence mode="wait">
          {isPending && <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><AnalysisLoader /></motion.div>}

          {error && !isPending && (
            <motion.div key="e" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 p-4 bg-red-500/8 border border-red-500/20 rounded-lg">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
              <div>
                <p className="text-xs font-mono text-red-400 uppercase tracking-wide">Analysis Failed</p>
                <p className="text-xs text-white/40 mt-1">{error.message}</p>
              </div>
            </motion.div>
          )}

          {hasAnalyzed && data && (
            <motion.div key="r" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
              <ResultsSection data={data} />
            </motion.div>
          )}

          {!hasAnalyzed && !isPending && !data && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8">
              <p className="text-[11px] font-mono text-white/40 uppercase tracking-[0.25em]">Enter a ticker above to begin analysis</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
