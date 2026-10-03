import type { ScreenElement, UnifiedScreenContext } from '../../shared/src/index.js';
export interface LocalVisionAdapter {
    readonly id: string;
    readonly capabilities: readonly ('faces' | 'ui' | 'regions' | 'classification')[];
    detect(image: ImageData, signal?: AbortSignal): Promise<readonly ScreenElement[]>;
    detectRegions?(image: ImageData, signal?: AbortSignal): Promise<readonly ScreenElement[]>;
    classifyRegion?(image: ImageData, region: ScreenElement['bbox'], signal?: AbortSignal): Promise<Readonly<{
        label: string;
        confidence: number;
    }>>;
}
export interface ScreenFusionAdapter {
    fuse(dom: readonly ScreenElement[], ocr: readonly ScreenElement[], vision: readonly ScreenElement[]): Pick<UnifiedScreenContext, 'elements' | 'ocrRegions' | 'visualDetections'>;
}
export declare class SemanticScreenFusion implements ScreenFusionAdapter {
    fuse(dom: readonly ScreenElement[], ocr: readonly ScreenElement[], vision: readonly ScreenElement[]): Pick<UnifiedScreenContext, 'elements' | 'ocrRegions' | 'visualDetections'>;
}
