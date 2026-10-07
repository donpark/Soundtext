import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rms } from "./audio.ts";

test("rms of silence is 0", () => {
  assert.equal(rms(new Float32Array(10)), 0);
});

test("rms of a full-scale square wave is 1", () => {
  assert.equal(rms(new Float32Array([1, -1, 1, -1])), 1);
});

test("rms of a half-scale signal is 0.5", () => {
  assert.equal(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
});
