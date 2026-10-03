import type { Action, UnifiedScreenContext } from '../../shared/src/index.js';
export interface ActionExecutor {
    execute(action: Action, latest: UnifiedScreenContext, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>;
}
