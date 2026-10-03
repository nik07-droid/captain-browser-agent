importScripts('vendor/ort.min.js', 'vision-core.js');

const MODEL_PATH = 'models/ultraface-rfb-320.onnx';
const MODEL_SHA256 = 'd7c687949526065ab6a192fdf993360045ce27b0fabf7c9fca5c2437b786b495';
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
const vendorBase = new URL('vendor/', self.location.href);
ort.env.wasm.wasmPaths = {
  mjs: new URL('ort-wasm-simd-threaded.mjs', vendorBase).href,
  wasm: new URL('ort-wasm-simd-threaded.wasm', vendorBase).href
};
let sessionPromise;

function session() {
  sessionPromise ||= ort.InferenceSession.create(new URL(MODEL_PATH, self.location.href).href, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return sessionPromise;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function imageTensor(imageData) {
  const pixels = imageData.data, plane = 320 * 240, values = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index++) {
    values[index] = (pixels[index * 4] - 127) / 128;
    values[plane + index] = (pixels[index * 4 + 1] - 127) / 128;
    values[plane * 2 + index] = (pixels[index * 4 + 2] - 127) / 128;
  }
  return new ort.Tensor('float32', values, [1, 3, 240, 320]);
}

function pixelateFace(output, source, box) {
  const marginX = (box.x2 - box.x1) * 0.16, marginY = (box.y2 - box.y1) * 0.2;
  const x = Math.max(0, Math.floor(box.x1 - marginX)), y = Math.max(0, Math.floor(box.y1 - marginY));
  const width = Math.min(output.width - x, Math.ceil(box.x2 - box.x1 + marginX * 2));
  const height = Math.min(output.height - y, Math.ceil(box.y2 - box.y1 + marginY * 2));
  if (width < 1 || height < 1) return;
  const tiny = new OffscreenCanvas(Math.max(3, Math.ceil(width / 14)), Math.max(3, Math.ceil(height / 14)));
  const tinyContext = tiny.getContext('2d', { alpha: false });
  tinyContext.drawImage(source, x, y, width, height, 0, 0, tiny.width, tiny.height);
  const context = output.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = false;
  context.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, width, height);
  context.fillStyle = 'rgba(0,0,0,.28)'; context.fillRect(x, y, width, height);
  context.imageSmoothingEnabled = true;
}

function blackout(context, box, label) {
  const margin = 3, x = Math.max(0, Math.floor(box.x1 - margin)), y = Math.max(0, Math.floor(box.y1 - margin));
  const width = Math.max(1, Math.ceil(box.x2 - box.x1 + margin * 2)), height = Math.max(1, Math.ceil(box.y2 - box.y1 + margin * 2));
  context.fillStyle = '#09090b'; context.fillRect(x, y, width, height);
  if (width > 72 && height > 18) { context.fillStyle = '#f43f5e'; context.font = 'bold 11px sans-serif'; context.fillText(String(label || 'REDACTED').slice(0, 20), x + 5, y + 14); }
}

async function redact(request) {
  const started = performance.now();
  const sourceBlob = await (await fetch(request.screenshot)).blob();
  const source = await createImageBitmap(sourceBlob);
  if (!source.width || !source.height || source.width * source.height > 12_000_000) throw new Error('Screenshot dimensions exceed the local privacy limit.');
  const resized = new OffscreenCanvas(320, 240), resizedContext = resized.getContext('2d', { alpha: false, willReadFrequently: true });
  resizedContext.drawImage(source, 0, 0, 320, 240);
  const detector = await session(), input = imageTensor(resizedContext.getImageData(0, 0, 320, 240));
  const inferenceStarted = performance.now();
  const outputs = await detector.run({ [detector.inputNames[0]]: input });
  const inferenceMs = performance.now() - inferenceStarted;
  const tensors = Object.values(outputs), scores = tensors.find(tensor => tensor.dims?.at(-1) === 2), boxes = tensors.find(tensor => tensor.dims?.at(-1) === 4);
  if (!scores || !boxes) throw new Error('Face model output is missing scores or boxes.');
  let faceMaxConfidence = 0;
  for (let index = 1; index < scores.data.length; index += 2) faceMaxConfidence = Math.max(faceMaxConfidence, Number(scores.data[index]) || 0);
  const faces = CaptainVisionCore.parseUltraFace(scores.data, scores.dims, boxes.data, boxes.dims, source.width, source.height, 0.7);
  const output = new OffscreenCanvas(source.width, source.height), context = output.getContext('2d', { alpha: false });
  context.drawImage(source, 0, 0);
  const scaleX = source.width / request.viewport.width, scaleY = source.height / request.viewport.height;
  const domBoxes = (request.redactionBoxes || []).map(box => CaptainVisionCore.mapDomBox(box, scaleX, scaleY, source.width, source.height)).filter(box => box.x2 > box.x1 && box.y2 > box.y1);
  domBoxes.forEach(box => blackout(context, box, box.kind));
  faces.forEach(face => pixelateFace(output, source, face));
  const sanitizedBlob = await output.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  if (sanitizedBlob.size > 2_500_000) throw new Error('Sanitized screenshot exceeds the outbound size limit.');
  const bytes = await sanitizedBlob.arrayBuffer(), binary = new Uint8Array(bytes);
  let encoded = ''; for (let offset = 0; offset < binary.length; offset += 0x8000) encoded += String.fromCharCode(...binary.subarray(offset, offset + 0x8000));
  return {
    screenshot: `data:image/jpeg;base64,${btoa(encoded)}`,
    visualPrivacy: {
      schema: 'captain.visual-privacy.v1', sanitized: true, rawScreenshotTransmitted: false,
      redactionApplied: true, domBoxes: domBoxes.length, faces: faces.length, faceMaxConfidence: Number(faceMaxConfidence.toFixed(4)),
      faceModel: 'ultraface-rfb-320', modelSha256: MODEL_SHA256,
      imageSha256: await sha256(bytes), input: { width: source.width, height: source.height },
      outputBytes: sanitizedBlob.size, inferenceMs: Math.round(inferenceMs), totalMs: Math.round(performance.now() - started), backend: 'wasm',
      workerJsHeapBytes: Number.isFinite(performance.memory?.usedJSHeapSize) ? performance.memory.usedJSHeapSize : null
    }
  };
}

self.onmessage = async event => {
  const id = event.data?.id;
  try { self.postMessage({ id, ok: true, result: await redact(event.data) }); }
  catch (error) { self.postMessage({ id, ok: false, error: error.message || String(error) }); }
};
