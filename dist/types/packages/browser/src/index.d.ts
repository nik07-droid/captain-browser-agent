export interface BrowserTab {
    id?: number;
    windowId: number;
    url?: string;
    incognito: boolean;
    active?: boolean;
}
export interface BrowserAdapter {
    readonly id: 'chrome' | 'firefox';
    captureVisibleTab(windowId: number): Promise<string>;
    getTab(tabId: number): Promise<BrowserTab>;
    updateTab(tabId: number, update: Readonly<{
        url?: string;
        active?: boolean;
    }>): Promise<BrowserTab>;
    sendToTab<T>(tabId: number, message: unknown): Promise<T>;
    getStorage<T extends Record<string, unknown>>(area: 'local' | 'sync' | 'session', defaults: T): Promise<T>;
    setStorage(area: 'local' | 'sync' | 'session', values: Record<string, unknown>): Promise<void>;
}
interface WebExtensionApi {
    tabs: {
        captureVisibleTab(windowId: number, options: {
            format: 'jpeg';
            quality: number;
        }): Promise<string>;
        get(tabId: number): Promise<BrowserTab>;
        update(tabId: number, update: Readonly<{
            url?: string;
            active?: boolean;
        }>): Promise<BrowserTab>;
        sendMessage<T>(tabId: number, message: unknown): Promise<T>;
    };
    storage: Record<'local' | 'sync' | 'session', {
        get<T>(defaults: T): Promise<T>;
        set(values: Record<string, unknown>): Promise<void>;
    }>;
}
declare abstract class BaseWebExtensionAdapter implements BrowserAdapter {
    protected readonly api: WebExtensionApi;
    abstract readonly id: 'chrome' | 'firefox';
    constructor(api: WebExtensionApi);
    captureVisibleTab(windowId: number): Promise<string>;
    getTab(tabId: number): Promise<BrowserTab>;
    updateTab(tabId: number, update: Readonly<{
        url?: string;
        active?: boolean;
    }>): Promise<BrowserTab>;
    sendToTab<T>(tabId: number, message: unknown): Promise<T>;
    getStorage<T extends Record<string, unknown>>(area: 'local' | 'sync' | 'session', defaults: T): Promise<T>;
    setStorage(area: 'local' | 'sync' | 'session', values: Record<string, unknown>): Promise<void>;
}
export declare class ChromeAdapter extends BaseWebExtensionAdapter {
    readonly id: 'chrome';
}
export declare class FirefoxAdapter extends BaseWebExtensionAdapter {
    readonly id: 'firefox';
}
export declare function createBrowserAdapter(api: WebExtensionApi, runtimeUrl: string): BrowserAdapter;
export {};
