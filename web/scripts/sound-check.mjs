#!/usr/bin/env node
// Measures sound-label accuracy against known ESC-50 clips: decodes each clip,
// classifies the max-energy 2 s window, and prints the top labels.
//
//   pnpm web sound-check
//
// Env: CHROME_PATH, SMOKE_PORT (default 5205).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.SMOKE_PORT ?? 5205);
const APP_URL = `http://localhost:${PORT}/`;
const BASE = "https://raw.githubusercontent.com/karoldvl/ESC-50/master/audio";

// category -> expected words in top labels (loose; ESC-50 clips are noisy)
const CLIPS = [
  { name: "clap", file: "1-104089-A-22.wav", expect: /clap|applause/i },
  { name: "glass", file: "1-20133-A-39.wav", expect: /break|glass|shatter|smash/i },
  { name: "dog", file: "1-100032-A-0.wav", expect: /bark|dog|bow-wow/i },
];

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
].filter((p) => p && existsSync(p))[0];
if (!chrome) {
  console.error("No Chrome found. Set CHROME_PATH.");
  process.exit(1);
}
const vite = new URL("../node_modules/.bin/vite", import.meta.url).pathname;
const server = spawn(vite, ["--port", String(PORT)], { stdio: "ignore" });
process.on("exit", () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* gone */
  }
});

for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(APP_URL)).ok) break;
  } catch {
    /* not up */
  }
  await new Promise((r) => setTimeout(r, 300));
}

const clips = {};
for (const c of CLIPS) {
  const res = await fetch(`${BASE}/${c.file}`);
  clips[c.name] = Buffer.from(await res.arrayBuffer()).toString("base64");
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: new URL("../.smoke-profile", import.meta.url).pathname,
  protocolTimeout: 10 * 60 * 1000,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(APP_URL, { waitUntil: "networkidle0" });

const out = await page.evaluate(async (clips) => {
  const decode = async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const ctx = new AudioContext({ sampleRate: 16000 });
    return (await ctx.decodeAudioData(u8.buffer)).getChannelData(0).slice();
  };
  const energy = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return s / a.length;
  };
  const mod = await import("/src/lib/sound.ts");
  await mod.loadSound();
  const res = {};
  for (const [name, b64] of Object.entries(clips)) {
    const f32 = await decode(b64);
    let bi = 0;
    let be = -1;
    for (let i = 0; i + 32000 <= f32.length; i += 1600) {
      const e = energy(f32.slice(i, i + 32000));
      if (e > be) {
        be = e;
        bi = i;
      }
    }
    const p = await mod.classifySound(f32.slice(bi, bi + 32000));
    res[name] = p
      .slice(0, 6)
      .map((x) => `${x.label}=${(x.score * 100).toFixed(1)}%`);
  }
  return res;
}, clips);

let failures = 0;
for (const c of CLIPS) {
  const top = out[c.name];
  const hit = top.findIndex((s) => c.expect.test(s));
  console.log(
    `${c.name.padEnd(6)} expected@${hit < 0 ? "-" : hit + 1}: ${top.join("  ")}`,
  );
  if (hit < 0 || hit >= 2) failures++;
}
console.log(failures ? `SOUND CHECK: ${failures} clip(s) missed` : "SOUND CHECK OK");
await browser.close();
server.kill("SIGTERM");
process.exit(failures ? 1 : 0);
