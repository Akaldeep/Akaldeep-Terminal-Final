import { useEffect, useRef, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Graticule,
  Sphere,
  ZoomableGroup,
} from "react-simple-maps";
import { motion, AnimatePresence } from "framer-motion";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const WORLD_CENTER:  [number, number] = [20, 10];
const INDIA_CENTER:  [number, number] = [78.9629, 22.5937];
const MUMBAI_CENTER: [number, number] = [72.8777, 19.0760];

type Phase = 0 | 1 | 2 | 3 | 4;

interface WorldMapProps {
  zoomed: boolean;
  analyzing: boolean;
  companyName?: string;
  exchange?: "NSE" | "BSE";
}

function Reticle({ visible, locked }: { visible: boolean; locked: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 1.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute pointer-events-none"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <motion.div
            className="absolute rounded-full border border-primary/50"
            style={{ width: 72, height: 72, top: -36, left: -36 }}
            animate={locked
              ? { scale: [1, 1.08, 1], opacity: [0.5, 0.9, 0.5] }
              : { scale: [1, 1.2, 1], opacity: [0.4, 0.15, 0.4] }}
            transition={{ duration: locked ? 1.2 : 2.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute rounded-full border-2 border-primary"
            style={{ width: 34, height: 34, top: -17, left: -17 }}
            animate={{ rotate: 360 }}
            transition={{ duration: locked ? 3 : 8, repeat: Infinity, ease: "linear" }}
          />
          {[
            { top: -26, left: -26, rotate: 0 },
            { top: -26, left: 14,  rotate: 90 },
            { top: 14,  left: 14,  rotate: 180 },
            { top: 14,  left: -26, rotate: 270 },
          ].map((pos, idx) => (
            <motion.div
              key={idx}
              className="absolute"
              style={{
                top: pos.top, left: pos.left,
                width: 12, height: 12,
                borderTop: "1.5px solid",
                borderLeft: "1.5px solid",
                borderColor: "hsl(38 92% 50%)",
                transform: `rotate(${pos.rotate}deg)`,
              }}
              animate={{ opacity: locked ? [1, 0.5, 1] : [0.6, 0.2, 0.6] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: idx * 0.15 }}
            />
          ))}
          <motion.div
            className="absolute rounded-full bg-primary"
            style={{ width: 6, height: 6, top: -3, left: -3 }}
            animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ExchangeBadge({ exchange, visible }: { exchange: "NSE" | "BSE"; visible: boolean }) {
  const isNSE = exchange === "NSE";
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="absolute pointer-events-none z-30"
          style={{ left: "50%", top: "calc(50% + 52px)", transform: "translateX(-50%)" }}
        >
          <motion.div
            className="absolute left-1/2 bg-primary/50"
            style={{ width: 1, height: 18, top: -20, transform: "translateX(-50%)" }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          />
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-black/80 border border-primary/40 backdrop-blur-sm">
              <motion.span className="text-primary text-[10px]"
                animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                ⊕
              </motion.span>
              <div className="flex flex-col">
                <span className="font-mono text-[9px] text-primary/60 uppercase tracking-wider">
                  {isNSE ? "National Stock Exchange" : "Bombay Stock Exchange"}
                </span>
                <span className="font-mono text-xs font-bold text-primary uppercase tracking-[0.2em]">
                  {isNSE ? "NSE · MUMBAI" : "BSE · MUMBAI"}
                </span>
              </div>
            </div>
            <span className="font-mono text-[8px] text-white/40 tracking-widest uppercase">
              {isNSE ? "Est. 1992 · Nifty 50 Index" : "Est. 1875 · Sensex Index"}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HudOverlay({ phase, analyzing, companyName, exchange }: {
  phase: Phase; analyzing: boolean; companyName?: string; exchange?: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 80);
    return () => clearInterval(t);
  }, []);
  const spinChar = ["⣾","⣽","⣻","⢿","⡿","⣟","⣯","⣷"][tick % 8];

  const coordLat = phase >= 3 ? "18.9600°N" : phase >= 1 ? "20.5937°N" : "00.0000°N";
  const coordLon = phase >= 3 ? "72.8777°E" : phase >= 1 ? "78.9629°E" : "00.0000°E";

  const statusText =
    phase === 0 ? "GLOBAL SCAN ACTIVE" :
    phase === 1 ? "TARGET: INDIA — ACQUIRING" :
    phase === 2 ? "HOMING IN → MUMBAI" :
    analyzing    ? "COMPUTING RISK METRICS" : "TARGET LOCKED · MUMBAI";

  const statusColor =
    phase <= 1 ? "text-primary/40" :
    phase === 2 ? "text-amber-400/70" :
    "text-emerald-400/80";

  return (
    <div className="absolute inset-0 pointer-events-none font-mono select-none z-20">
      <div className="absolute top-3 left-3 text-[9px] text-primary/50 space-y-0.5">
        <div>LAT {coordLat}</div>
        <div>LON {coordLon}</div>
        <div className="mt-1 text-primary/30">PROJ: NATURAL EARTH</div>
      </div>
      <div className="absolute top-3 right-3 text-[9px] text-right space-y-0.5">
        <div className={`flex items-center gap-1.5 justify-end ${statusColor}`}>
          {phase >= 1 && <span>{spinChar}</span>}
          <span>{statusText}</span>
        </div>
        <div className="text-primary/25">NSE / BSE INDICES</div>
        <div className="text-primary/25">REGION: SOUTH ASIA</div>
      </div>
      <AnimatePresence>
        {phase >= 3 && companyName && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ delay: 0.4 }}
            className="absolute text-[9px] text-primary/80 uppercase tracking-[0.2em]"
            style={{ left: "50%", top: "calc(50% - 52px)", transform: "translateX(-50%)" }}
          >
            <span className="text-primary/40 mr-1">▶</span>{companyName}
          </motion.div>
        )}
      </AnimatePresence>
      {analyzing && (
        <motion.div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent"
          animate={{ top: ["0%", "100%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />
      )}
      <div className="absolute bottom-3 left-3 text-[8px] text-primary/25 space-y-0.5">
        <div>AKALDEEP RISK INTEL v1.0</div>
        <div>DAMODARAN CLASSIFICATION ENGINE</div>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-[8px] text-primary/25">
        <div className="w-8 h-px bg-primary/25" />
        <span>{phase >= 3 ? "50 KM" : phase >= 1 ? "500 KM" : "5000 KM"}</span>
      </div>
    </div>
  );
}

export function WorldMap({ zoomed, analyzing, companyName, exchange = "NSE" }: WorldMapProps) {
  const [phase, setPhase] = useState<Phase>(0);
  const [mapCenter, setMapCenter] = useState<[number, number]>(WORLD_CENTER);
  const [mapZoom, setMapZoom] = useState(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  useEffect(() => {
    clearTimers();
    if (!zoomed && !analyzing) {
      setPhase(0); setMapCenter(WORLD_CENTER); setMapZoom(1);
      return;
    }
    // Phase 1: zoom to India
    timers.current.push(setTimeout(() => {
      setPhase(1); setMapCenter(INDIA_CENTER); setMapZoom(4);
    }, 300));
    // Phase 2: zoom to Mumbai
    timers.current.push(setTimeout(() => {
      setPhase(2); setMapCenter(MUMBAI_CENTER); setMapZoom(11);
    }, 2000));
    // Phase 3: lock on exchange
    timers.current.push(setTimeout(() => { setPhase(3); }, 3600));
    // Phase 4: hold
    timers.current.push(setTimeout(() => { setPhase(4); }, 5200));
    return clearTimers;
  }, [zoomed, analyzing]);

  const mapTransition =
    phase === 1 ? "all 1.7s cubic-bezier(0.16,1,0.3,1)" :
    phase === 2 ? "all 1.5s cubic-bezier(0.16,1,0.3,1)" : "none";

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute inset-0 z-10 pointer-events-none opacity-[0.035]"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,#000 2px,#000 4px)" }} />
      <div className="absolute inset-0 z-10 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, transparent 35%, hsl(240,10%,4%) 88%)" }} />

      <ComposableMap projection="geoNaturalEarth1"
        projectionConfig={{ scale: 155, center: [0, 0] }}
        style={{ width: "100%", height: "100%", pointerEvents: "none" as const }}>
        <ZoomableGroup center={mapCenter} zoom={mapZoom}
          // @ts-ignore
          style={{ transition: mapTransition }}
          minZoom={mapZoom} maxZoom={mapZoom}
          onMoveStart={({ coordinates, zoom }: any) => { return false; }}
        >
          <Sphere id="ocean-sphere" fill="hsl(240,15%,5%)" stroke="transparent" />
          <Graticule stroke="hsl(240,8%,14%)" strokeWidth={0.4} />
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const isIndia = geo.id === 356 || geo.properties?.name === "India";
                return (
                  <Geography key={geo.rsmKey} geography={geo}
                    fill={isIndia ? "hsl(38,70%,22%)" : "hsl(240,8%,9%)"}
                    stroke={isIndia ? "hsl(38,92%,50%)" : "hsl(240,6%,18%)"}
                    strokeWidth={isIndia ? 0.8 : 0.3}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: isIndia ? "hsl(38,80%,28%)" : "hsl(240,8%,13%)" },
                      pressed: { outline: "none" },
                    }} />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* India ambient glow */}
      <motion.div className="absolute pointer-events-none"
        style={{ left: "63%", top: "35%", width: 130, height: 110,
          background: "radial-gradient(ellipse, hsl(38 92% 50% / 0.18) 0%, transparent 70%)",
          transform: "translate(-50%,-50%)" }}
        animate={{ opacity: phase >= 1 ? [0.7, 1, 0.7] : [0.3, 0.5, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />

      {/* Mumbai pulse dot */}
      <AnimatePresence>
        {phase >= 2 && (
          <motion.div initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute pointer-events-none z-25"
            style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
            <motion.div className="absolute rounded-full bg-primary/90"
              style={{ width: 8, height: 8, top: -4, left: -4 }}
              animate={{ scale: [1, 2.5, 1], opacity: [1, 0, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reticle centered */}
      <div className="absolute inset-0 z-25 pointer-events-none flex items-center justify-center">
        <Reticle visible={phase >= 1} locked={phase >= 3} />
      </div>

      {/* Exchange badge */}
      <div className="absolute inset-0 z-25 pointer-events-none flex items-center justify-center">
        <ExchangeBadge exchange={exchange} visible={phase >= 3} />
      </div>

      <HudOverlay phase={phase} analyzing={analyzing} companyName={companyName} exchange={exchange} />
    </div>
  );
}
