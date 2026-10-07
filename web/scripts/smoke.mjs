#!/usr/bin/env node
// Headless end-to-end smoke test. Boots the Vite dev server, loads the app in
// Chrome with a fake microphone, and asserts that WebGPU is available, the
// LiteRT-LM model loads, and the classifier produces a label.
//
//   pnpm web smoke
//
// Env: CHROME_PATH, SMOKE_PORT (default 5199), SMOKE_TIMEOUT_MS.
//
// The page must be on a secure origin — http://localhost counts, about:blank
// does not, and on an insecure origin navigator.gpu is undefined.
// First run downloads the ~485 MB model + ~108 MB LiteRT WASM; later runs are
// cached (including the per-label embeddings).
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.SMOKE_PORT ?? 5199);
const APP_URL = `http://localhost:${PORT}/`;
const ORIGIN = `http://localhost:${PORT}`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15 * 60 * 1000);

// Feed a real clap as the fake microphone: a synthetic tone classifies as
// low-confidence "Sound effect" and is correctly filtered by the gate.
const SOUND_WAV = process.env.SOUND_WAV ?? join(tmpdir(), "soundtext-clap.wav");
if (!existsSync(SOUND_WAV)) {
  const res = await fetch(
    "https://raw.githubusercontent.com/karoldvl/ESC-50/master/audio/1-104089-A-22.wav",
  );
  writeFileSync(SOUND_WAV, Buffer.from(await res.arrayBuffer()));
}

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p) => p && existsSync(p))[0];
if (!chrome) {
  console.error("No Chrome found. Set CHROME_PATH to a Chrome/Chromium binary.");
  process.exit(1);
}

const vite = new URL("../node_modules/.bin/vite", import.meta.url).pathname;
const server = spawn(vite, ["--port", String(PORT)], { stdio: "ignore" });
const stopServer = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stopServer);

async function waitForServer(ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(APP_URL)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server did not start at ${APP_URL}`);
}

const notes = [];
async function run() {
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    // Persistent profile so the ~485 MB model and the label-embedding cache
    // survive between runs instead of re-downloading every time.
    userDataDir: new URL("../.smoke-profile", import.meta.url).pathname,
    protocolTimeout: TIMEOUT_MS,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${SOUND_WAV}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    await browser.defaultBrowserContext().overridePermissions(ORIGIN, ["microphone"]);
    const page = await browser.newPage();
    page.on("console", (m) => {
      const text = m.text();
      if (text.includes("[soundtext]")) console.log("  " + text);
      else if (m.type() === "error") notes.push(text);
    });
    page.on("pageerror", (e) => notes.push(`pageerror: ${e.message}`));

    await page.goto(APP_URL, { waitUntil: "networkidle0" });

    const ctx = await page.evaluate(() => ({
      secure: isSecureContext,
      gpu: !!navigator.gpu,
    }));
    console.log(`secure context: ${ctx.secure} · WebGPU: ${ctx.gpu}`);
    if (!ctx.gpu) {
      throw new Error(
        "navigator.gpu is undefined — open the app over http://localhost or https://",
      );
    }

    const clicked = await page.evaluate(async (cold) => {
      if (cold) await caches.delete("soundtext-label-embeddings");
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Start listening"),
      );
      button?.click();
      return !!button;
    }, !!process.env.SMOKE_COLD_LABELS);
    if (!clicked) throw new Error("Start listening button not found");

    await page.waitForFunction(
      () => /model ready|failed to load|Microphone failed/.test(document.body.innerText),
      { timeout: TIMEOUT_MS, polling: 2000 },
    );
    const body = await page.evaluate(() => document.body.innerText);
    if (/failed to load|Microphone failed/.test(body)) {
      const line = body.split("\n").find((l) => /failed/i.test(l)) ?? "";
      throw new Error(`app reported an error: ${line.trim()}`);
    }

    await page.waitForFunction(
      () => document.querySelector("[data-sound-label]")?.getAttribute("data-sound-label"),
      { timeout: TIMEOUT_MS, polling: 1000 },
    );
    const label = await page.evaluate(
      () =>
        document
          .querySelector("[data-sound-label]")
          ?.getAttribute("data-sound-label") ?? "",
    );
    console.log(`sound classification: ${label}`);

    // A sound must actually reach the ticker, not just be classified.
    await page.waitForFunction(
      () => /\[(clap|applause)[^\]]*\]/i.test(document.body.innerText),
      { timeout: 60000, polling: 500 },
    );
    const token = await page.evaluate(
      () => document.body.innerText.match(/\[[^\]]+\]/)?.[0] ?? "",
    );
    console.log(`ticker sound token: ${token}`);

    // The speech pipeline loads in the background; wait for VAD to come up.
    await page.waitForFunction(
      () => {
        const s = document
          .querySelector("[data-speech-status]")
          ?.getAttribute("data-speech-status");
        return s && s !== "idle" && s !== "loading";
      },
      { timeout: TIMEOUT_MS, polling: 2000 },
    );
    const speech = await page.evaluate(() =>
      document
        .querySelector("[data-speech-status]")
        ?.getAttribute("data-speech-status"),
    );
    console.log(`speech pipeline: ${speech}`);
    if (speech === "error") {
      throw new Error("speech pipeline failed to start (see page errors above)");
    }
  } finally {
    await browser.close();
  }
}

let failed = false;
try {
  await run();
  console.log("SMOKE OK");
} catch (e) {
  failed = true;
  console.error(`SMOKE FAILED: ${e.message}`);
  if (notes.length) console.error("page errors:\n  " + notes.join("\n  "));
} finally {
  stopServer();
}
process.exit(failed ? 1 : 0);
