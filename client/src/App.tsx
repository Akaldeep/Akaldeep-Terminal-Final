import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";
import { motion } from "framer-motion";
import { Activity, Zap } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex flex-col min-h-screen w-full bg-background">
          {/* Slim header */}
          <header className="h-12 flex items-center justify-between px-5 border-b border-white/6 bg-black/40 backdrop-blur-lg z-50 shrink-0 sticky top-0">
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center gap-2.5"
            >
              <div className="w-6 h-6 rounded bg-primary/10 border border-primary/25 flex items-center justify-center">
                <Activity className="w-3 h-3 text-primary" />
              </div>
              <div>
                <span className="font-display text-sm leading-none tracking-wider text-white/90">AKALDEEP</span>
                <span className="hidden sm:inline font-mono text-[8px] text-white/25 tracking-[0.18em] uppercase ml-3">Risk Intelligence Terminal</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/8 border border-emerald-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-mono text-emerald-400/70 tracking-wider uppercase">Live</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] font-mono text-white/20 tracking-wider">
                <Zap className="w-3 h-3 text-primary/50" /> v1.0
              </div>
            </motion.div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <Router />
          </main>
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
