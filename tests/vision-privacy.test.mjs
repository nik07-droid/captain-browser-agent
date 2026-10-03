import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const sandbox = { globalThis: {} };
vm.runInNewContext(await readFile(new URL('../extension/vision-core.js', import.meta.url), 'utf8'), sandbox);
const core = sandbox.globalThis.CaptainVisionCore;

test('UltraFace output parsing thresholds, clamps and suppresses overlapping faces', () => {
  const scores = new Float32Array([0.01, 0.99, 0.05, 0.95, 0.9, 0.1]);
  const boxes = new Float32Array([0.1, 0.1, 0.5, 0.5, 0.12, 0.12, 0.51, 0.51, -1, -1, 2, 2]);
  const faces = core.parseUltraFace(scores, [1, 3, 2], boxes, [1, 3, 4], 1000, 500, 0.7);
  assert.equal(faces.length, 1);
  assert.ok(Math.abs(faces[0].x1 - 100) < 0.01);
  assert.ok(Math.abs(faces[0].y2 - 250) < 0.01);
  assert.throws(() => core.parseUltraFace(scores, [1, 3, 3], boxes, [1, 3, 4], 100, 100));
});

test('DOM privacy boxes map from CSS viewport coordinates into screenshot pixels', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.mapDomBox({ x: 10, y: 20, width: 30, height: 40, kind: 'EMAIL' }, 2, 1.5, 200, 150))), { x1: 20, y1: 30, x2: 80, y2: 90, kind: 'EMAIL' });
  assert.deepEqual(JSON.parse(JSON.stringify(core.mapDomBox({ x: -10, y: -20, width: 500, height: 400 }, 2, 2, 200, 150))), { x1: 0, y1: 0, x2: 200, y2: 150, kind: 'PII' });
});

test('vision worker contains local inference, face pixelation and irreversible DOM blackout', async () => {
  const source = await readFile(new URL('../extension/vision-worker.js', import.meta.url), 'utf8');
  assert.match(source, /InferenceSession\.create/);
  assert.match(source, /executionProviders: \['wasm'\]/);
  assert.match(source, /pixelateFace/);
  assert.match(source, /fillRect\(x, y, width, height\)/);
  assert.match(source, /rawScreenshotTransmitted: false/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/);
});
