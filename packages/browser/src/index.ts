export interface BrowserTab { id?: number; windowId: number; url?: string; incognito: boolean; active?: boolean }
export interface BrowserAdapter {
  readonly id: 'chrome' | 'firefox';
  captureVisibleTab(windowId: number): Promise<string>;
  getTab(tabId: number): Promise<BrowserTab>;
  updateTab(tabId: number, update: Readonly<{ url?: string; active?: boolean }>): Promise<BrowserTab>;
  sendToTab<T>(tabId: number, message: unknown): Promise<T>;
  getStorage<T extends Record<string, unknown>>(area: 'local' | 'sync' | 'session', defaults: T): Promise<T>;
  setStorage(area: 'local' | 'sync' | 'session', values: Record<string, unknown>): Promise<void>;
}

interface WebExtensionApi {
  tabs: {
    captureVisibleTab(windowId: number, options: { format: 'jpeg'; quality: number }): Promise<string>;
    get(tabId: number): Promise<BrowserTab>;
    update(tabId: number, update: Readonly<{ url?: string; active?: boolean }>): Promise<BrowserTab>;
    sendMessage<T>(tabId: number, message: unknown): Promise<T>;
  };
  storage: Record<'local' | 'sync' | 'session', { get<T>(defaults: T): Promise<T>; set(values: Record<string, unknown>): Promise<void> }>;
}

abstract class BaseWebExtensionAdapter implements BrowserAdapter {
  abstract readonly id: 'chrome' | 'firefox';
  constructor(protected readonly api: WebExtensionApi) {}
  captureVisibleTab(windowId: number) { return this.api.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }); }
  getTab(tabId: number) { return this.api.tabs.get(tabId); }
  updateTab(tabId: number, update: Readonly<{ url?: string; active?: boolean }>) { return this.api.tabs.update(tabId, update); }
  sendToTab<T>(tabId: number, message: unknown) { return this.api.tabs.sendMessage<T>(tabId, message); }
  getStorage<T extends Record<string, unknown>>(area: 'local' | 'sync' | 'session', defaults: T) { return this.api.storage[area].get(defaults); }
  setStorage(area: 'local' | 'sync' | 'session', values: Record<string, unknown>) { return this.api.storage[area].set(values); }
}

export class ChromeAdapter extends BaseWebExtensionAdapter { readonly id = 'chrome' as const; }
export class FirefoxAdapter extends BaseWebExtensionAdapter { readonly id = 'firefox' as const; }

export function createBrowserAdapter(api: WebExtensionApi, runtimeUrl: string): BrowserAdapter {
  return /moz-extension:/i.test(runtimeUrl) ? new FirefoxAdapter(api) : new ChromeAdapter(api);
}
