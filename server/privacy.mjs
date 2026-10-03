import { createHash } from 'node:crypto';

const PATTERNS = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['phone', /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g],
  ['card', /\b(?:\d[ -]*?){13,19}\b/g],
  ['aadhaar', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
  ['pan', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
];

const FACE_MODEL_SHA256 = 'd7c687949526065ab6a192fdf993360045ce27b0fabf7c9fca5c2437b786b495';

export function validateSanitizedScreenshot(context = {}) {
  if (!context.screenshot) return { ok: true, present: false };
  const proof = context.visualPrivacy;
  if (!proof || proof.schema !== 'captain.visual-privacy.v1' || proof.sanitized !== true || proof.rawScreenshotTransmitted !== false || proof.redactionApplied !== true) return { ok: false, error: 'missing local redaction proof' };
  if (proof.faceModel !== 'ultraface-rfb-320' || proof.modelSha256 !== FACE_MODEL_SHA256) return { ok: false, error: 'unexpected local face model' };
  if (![proof.domBoxes, proof.faces, proof.inferenceMs, proof.totalMs, proof.outputBytes].every(value => Number.isFinite(value) && value >= 0)) return { ok: false, error: 'invalid visual metrics' };
  const match = String(context.screenshot).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return { ok: false, error: 'visual payload must be a JPEG data URL' };
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes.length > 2_500_000 || bytes.length !== proof.outputBytes) return { ok: false, error: 'visual payload size mismatch' };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return { ok: false, error: 'visual payload is not a JPEG bitstream' };
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== proof.imageSha256) return { ok: false, error: 'visual payload hash mismatch' };
  return { ok: true, present: true, bytes: bytes.length };
}

export function scanText(value = '') {
  const findings = [];
  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) findings.push({ kind, index: match.index, length: match[0].length });
  }
  return findings;
}

export function redactText(value = '') {
  let text = String(value);
  const counts = {};
  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, () => {
      counts[kind] = (counts[kind] || 0) + 1;
      return `[REDACTED_${kind.toUpperCase()}]`;
    });
  }
  return { text, counts };
}

export function payloadLeaks(value) {
  const findings = [];
  // Scan decoded field values, not serialized JSON: an escaped newline before
  // @channel.example otherwise invents an email address "n@channel.example".
  function walk(node, path = 'root') {
    if (typeof node === 'string') findings.push(...scanText(node).map(item => ({ ...item, path })));
    // Numeric fields are measurements, counters and geometry in the protocol.
    // User-visible values are serialized as strings by the page observer.
    // Scanning floating-point coordinates creates random 13–19 digit matches.
    else if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) {
      findings.push(...scanText(key).map(item => ({ ...item, path })));
      if (path === 'root.context' && key === 'screenshot' && child) {
        if (!validateSanitizedScreenshot(node).ok) findings.push({ kind: 'unverified_screenshot', path: `${path}.${key}` });
      }
      else if (path === 'root.context.visualPrivacy' && ['imageSha256', 'modelSha256', 'schema', 'faceModel'].includes(key)) {
        // Integrity identifiers are validated structurally by
        // validateSanitizedScreenshot. Digit runs inside a SHA-256 digest are
        // not user card numbers and must not create random false positives.
      }
      else walk(child, `${path}.${key}`);
    }
  }
  walk(value);
  return findings;
}
