#!/usr/bin/env node
// End-to-end speech check: Chrome plays a real speech WAV as the fake
// microphone, so the whole chain runs — Silero VAD detects an utterance, Whisper
// transcribes it, and the UI shows it.
//
//   pnpm web speech-e2e
//
// Env: CHROME_PATH, SMOKE_PORT (default 5201), SPEECH_WAV (downloaded if absent).
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.SMOKE_PORT ?? 5201);
const APP_URL = `http://localhost:${PORT}/`;
const ORIGIN = `http://localhost:${PORT}`;
const WAV = process.env.SPEECH_WAV ?? join(tmpdir(), "soundtext-jfk.wav");
if (!existsSync(WAV)) {
  const res = await fetch(
    "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
  );
  writeFileSync(WAV, Buffer.from(await res.arrayBuffer()));
}

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
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV}`,
    ],
  });
  try {
    await browser.defaultBrowserContext().overridePermissions(ORIGIN, ["microphone"]);
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.text().includes("[soundtext]")) console.log("  " + m.text());
    });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.goto(APP_URL, { waitUntil: "networkidle0" });

    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Start listening"))
        ?.click();
    });

    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-speech-status]")
          ?.getAttribute("data-speech-status") === "listening",
      { timeout: 10 * 60 * 1000, polling: 2000 },
    );
    console.log("VAD listening; waiting for a transcript…");

    // Read the ticker tokens, never the page text: the demo copy contains
    // "...when the browser asks", which matches /ask/ and made this check pass
    // without a transcript.
    const tokens = () =>
      page.$$eval("[data-ticker-item]", (els) =>
        els.map((el) => ({
          kind: el.getAttribute("data-ticker-kind"),
          text: el.getAttribute("data-ticker-item"),
        })),
      );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-ticker-kind="speech"]')].some((el) =>
          /fellow|america|country/i.test(el.getAttribute("data-ticker-item")),
        ),
      { timeout: 120000, polling: 1000 },
    );
    const seen = await tokens();
    const speech = seen.filter((t) => t.kind === "speech");
    const sounds = seen.filter((t) => t.kind === "sound");
    console.log(`ticker speech: ${speech.map((t) => t.text).join(" ")}`);
    console.log(`ticker sounds: ${sounds.map((t) => t.text).join(" ")}`);
    if (!speech.some((t) => /fellow|america|country/i.test(t.text))) {
      throw new Error("transcript did not appear in the ticker");
    }
    // The speech channel owns speech. A [Speech] token from the sound
    // classifier is the same news, earlier and vaguer.
    const vague = sounds.filter((t) =>
      /^\[(speech|conversation|narration)(,|])/i.test(t.text),
    );
    if (vague.length) {
      throw new Error(
        `sound channel announced speech the speech channel owns: ${vague.map((t) => t.text).join(" ")}`,
      );
    }
    console.log("SPEECH E2E OK");
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(`SPEECH E2E FAILED: ${e.message}`);
} finally {
  stopServer();
}
process.exit(failed ? 1 : 0);
