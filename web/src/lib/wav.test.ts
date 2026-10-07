import { strict as assert } from "node:assert";
import { test } from "node:test";
import { encodeWav } from "./wav.ts";

async function bytes(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

test("writes a 44-byte header for mono 16-bit PCM", async () => {
  const blob = encodeWav(new Float32Array(4), 16000);
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 44 + 8);
  const v = await bytes(blob);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(v.getUint16(20, true), 1); // PCM
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8); // data size
});

test("clamps samples and round-trips magnitudes", async () => {
  const v = await bytes(encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 8000));
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), 0x7fff); // +1 clamps to max
  assert.equal(v.getInt16(48, true), -0x8000); // -1 clamps to min
  assert.equal(v.getInt16(50, true), 0x7fff); // +2 clamps
  assert.equal(v.getInt16(52, true), -0x8000); // -2 clamps
  assert.equal(v.getInt16(54, true), Math.trunc(0.5 * 0x7fff));
});
