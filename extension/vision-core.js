(function (root) {
  function clamp(value, low, high) { return Math.min(high, Math.max(low, Number(value) || 0)); }
  function iou(a, b) {
    const left = Math.max(a.x1, b.x1), top = Math.max(a.y1, b.y1);
    const right = Math.min(a.x2, b.x2), bottom = Math.min(a.y2, b.y2);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1) + Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1) - intersection;
    return union > 0 ? intersection / union : 0;
  }
  function nms(candidates, threshold = 0.3, limit = 30) {
    const sorted = [...candidates].sort((a, b) => b.score - a.score), kept = [];
    while (sorted.length && kept.length < limit) {
      const current = sorted.shift(); kept.push(current);
      for (let index = sorted.length - 1; index >= 0; index--) if (iou(current, sorted[index]) > threshold) sorted.splice(index, 1);
    }
    return kept;
  }
  function parseUltraFace(scores, scoreDims, boxes, boxDims, width, height, threshold = 0.7) {
    const count = Number(scoreDims?.at(-2) || boxDims?.at(-2) || 0);
    if (!count || scoreDims?.at(-1) !== 2 || boxDims?.at(-1) !== 4 || scores.length < count * 2 || boxes.length < count * 4) throw new Error('UltraFace output tensor contract changed.');
    const candidates = [];
    for (let index = 0; index < count; index++) {
      const score = scores[index * 2 + 1];
      if (!Number.isFinite(score) || score < threshold) continue;
      const x1 = clamp(boxes[index * 4] * width, 0, width), y1 = clamp(boxes[index * 4 + 1] * height, 0, height);
      const x2 = clamp(boxes[index * 4 + 2] * width, 0, width), y2 = clamp(boxes[index * 4 + 3] * height, 0, height);
      if (x2 - x1 >= 4 && y2 - y1 >= 4) candidates.push({ x1, y1, x2, y2, score });
    }
    return nms(candidates, 0.3, 30);
  }
  function mapDomBox(box, scaleX, scaleY, width, height) {
    const x1 = clamp(box.x * scaleX, 0, width), y1 = clamp(box.y * scaleY, 0, height);
    const x2 = clamp((box.x + box.width) * scaleX, 0, width), y2 = clamp((box.y + box.height) * scaleY, 0, height);
    return { x1, y1, x2, y2, kind: String(box.kind || 'PII').slice(0, 40) };
  }
  root.CaptainVisionCore = { clamp, iou, nms, parseUltraFace, mapDomBox };
})(globalThis);
