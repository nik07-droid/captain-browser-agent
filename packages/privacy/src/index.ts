import type { PrivacyRegion, UnifiedScreenContext } from '../../shared/src/index.js';
export interface LocalPrivacyDetector { detect(context: UnifiedScreenContext, signal?: AbortSignal): Promise<readonly PrivacyRegion[]> }
export interface LocalRedactor { sanitize(raw: ImageData, regions: readonly PrivacyRegion[]): Promise<{ image: Blob; sha256: string; regions: readonly PrivacyRegion[] }> }
