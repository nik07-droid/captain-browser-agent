function overlap(a, b) {
    const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a.width * a.height + b.width * b.height - intersection;
    return union > 0 ? intersection / union : 0;
}
export class SemanticScreenFusion {
    fuse(dom, ocr, vision) {
        const fused = dom.map(element => {
            const ocrMatch = ocr.find(candidate => overlap(element.bbox, candidate.bbox) >= 0.45);
            const visionMatch = vision.find(candidate => overlap(element.bbox, candidate.bbox) >= 0.45);
            if (!ocrMatch && !visionMatch)
                return element;
            const text = element.text || ocrMatch?.text || visionMatch?.text || '';
            const confidence = Math.min(1, element.confidence * 0.55 + (ocrMatch?.confidence || 0) * 0.25 + (visionMatch?.confidence || 0) * 0.2 + 0.1);
            return { ...element, text, confidence, source: 'fused' };
        });
        const matched = new Set(fused.map(item => item.ref));
        const additions = [...ocr, ...vision].filter(item => !matched.has(item.ref));
        return { elements: [...fused, ...additions], ocrRegions: ocr, visualDetections: vision };
    }
}
