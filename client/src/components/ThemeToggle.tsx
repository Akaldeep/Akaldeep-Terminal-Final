import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { motion } from "framer-motion";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative w-8 h-8 rounded-md border border-border bg-muted/40 hover:bg-muted/80 flex items-center justify-center transition-colors duration-200"
      aria-label="Toggle theme"
    >
      <AnimateIcon show={isDark}>
        <Moon className="w-3.5 h-3.5 text-muted-foreground" />
      </AnimateIcon>
      <AnimateIcon show={!isDark}>
        <Sun className="w-3.5 h-3.5 text-muted-foreground" />
      </AnimateIcon>
    </motion.button>
  );
}

function AnimateIcon({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute"
      initial={false}
      animate={{ opacity: show ? 1 : 0, rotate: show ? 0 : 20, scale: show ? 1 : 0.6 }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
}
