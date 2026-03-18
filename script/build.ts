import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "exceljs",
  "express",
  "express-rate-limit",
  "date-fns",
  "zod",
  "zod-validation-error",
];

// Copy attached_assets into dist so Railway can find the Excel file at runtime
async function copyAssets() {
  const { cp } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const src = 'attached_assets';
  const dest = 'dist/attached_assets';
  if (existsSync(src)) {
    await cp(src, dest, { recursive: true });
    console.log('Copied attached_assets -> dist/attached_assets');
  }
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().then(() => copyAssets()).catch((err) => {
  console.error(err);
  process.exit(1);
});
