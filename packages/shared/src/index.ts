export type BBox = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Source = 'dom' | 'ocr' | 'vision' | 'fused';
export interface ScreenElement { ref: `c${number}`; role: string; text: string; bbox: BBox; state: Readonly<Record<string, boolean | string>>; confidence: number; source: Source; sensitive?: boolean; sensitiveType?: string }
export interface ScreenRegion { id: string; role: string; text: string; bbox: BBox; state: Readonly<Record<string, boolean | string | number | null>>; confidence: number; source: 'DOM' | 'OCR' | 'VISION' | 'FUSED' | 'VISION_GEOMETRY' }
export interface OcrObservation { status: 'ready' | 'cached' | 'unavailable' | 'not-configured' | 'error'; regions: readonly ScreenRegion[]; cached: boolean; latencyMs?: number; cacheKey?: string; note?: string }
export interface PrivacyRegion { type: string; bbox: BBox; confidence: number; detector: string; method: 'blackout' | 'blur' | 'pixelate' | 'replace' }
export interface UnifiedScreenContext { url: string; title: string; viewport: Readonly<{ width: number; height: number; devicePixelRatio: number }>; elements: readonly ScreenElement[]; textRegions: readonly ScreenRegion[]; visualRegions: readonly ScreenRegion[]; interactiveRegions: readonly ScreenElement[]; ocr: OcrObservation; ocrRegions: readonly ScreenElement[]; visualDetections: readonly ScreenElement[]; sensitiveRegions: readonly PrivacyRegion[]; redactionRegions: readonly PrivacyRegion[]; confidence: Readonly<{ dom: number; ocr: number; vision: number; fused: number }>; screenshotMetadata?: Readonly<{ sanitized: true; format: 'image/jpeg'; bytes: number; sha256: string; rawScreenshotTransmitted: false }>; screenshot?: string; screenshotSha256?: string }
export type Action =
  | { type: 'click' | 'hover' | 'submit'; target: { ref: `c${number}` }; confidence?: number; reason?: string }
  | { type: 'type' | 'select'; target: { ref: `c${number}` }; value: string; confidence?: number; reason?: string }
  | { type: 'press'; target: { ref: `c${number}` }; key: string; confidence?: number; reason?: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number; confidence?: number; reason?: string }
  | { type: 'navigate'; url: string; confidence?: number; reason?: string }
  | { type: 'back' | 'wait'; confidence?: number; reason?: string }
  | { type: 'request_local_input'; target: { ref: `c${number}` }; inputType: string; confidence?: number; reason?: string }
  | { type: 'done'; message: string; confidence?: number; reason?: string };
export interface VisionReasoningProvider { readonly id: string; plan(task: string, context: UnifiedScreenContext, history: readonly Action[]): Promise<Action> }
