#!/usr/bin/env node
// Verifies the speech path in a real browser: loads whisper-base on WebGPU and
// transcribes a known 16 kHz clip. VAD gating is exercised by `pnpm web smoke`
// (Silero initialises); this check is about ASR correctness.
//
//   pnpm web speech-check
//
// Env: CHROME_PATH, SMOKE_PORT (default 5200).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.SMOKE_PORT ?? 5200);
const APP_URL = `http://localhost:${PORT}/`;
const WAV =
  "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

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
const stopServer = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* gone */
  }
};
process.on("exit", stopServer);

async function waitForServer(ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(APP_URL)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("dev server did not start");
}

let failed = false;
try {
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: new URL("../.smoke-profile", import.meta.url).pathname,
    protocolTimeout: 15 * 60 * 1000,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (/soundtext|error/i.test(m.text())) console.log("  [page]", m.text());
    });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.goto(APP_URL, { waitUntil: "networkidle0" });

    console.log("decoding clip + loading whisper…");
    const result = await page.evaluate(async (wavUrl) => {
      const buf = await (await fetch(wavUrl)).arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 16000 });
      const decoded = await ctx.decodeAudioData(buf);
      const pcm = decoded.getChannelData(0).slice();
      const mod = await import("/src/lib/speech.ts");
      const text = await mod.transcribe(pcm);
      return { seconds: +decoded.duration.toFixed(2), text };
    }, WAV);

    console.log(`clip: ${result.seconds}s | transcript: "${result.text}"`);
    if (!/country/i.test(result.text)) {
      throw new Error("transcript did not contain the expected word");
    }
    console.log("SPEECH CHECK OK");
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(`SPEECH CHECK FAILED: ${e.message}`);
} finally {
  stopServer();
}
process.exit(failed ? 1 : 0);
