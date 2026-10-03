class BaseWebExtensionAdapter {
    api;
    constructor(api) {
        this.api = api;
    }
    captureVisibleTab(windowId) { return this.api.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }); }
    getTab(tabId) { return this.api.tabs.get(tabId); }
    updateTab(tabId, update) { return this.api.tabs.update(tabId, update); }
    sendToTab(tabId, message) { return this.api.tabs.sendMessage(tabId, message); }
    getStorage(area, defaults) { return this.api.storage[area].get(defaults); }
    setStorage(area, values) { return this.api.storage[area].set(values); }
}
export class ChromeAdapter extends BaseWebExtensionAdapter {
    id = 'chrome';
}
export class FirefoxAdapter extends BaseWebExtensionAdapter {
    id = 'firefox';
}
export function createBrowserAdapter(api, runtimeUrl) {
    return /moz-extension:/i.test(runtimeUrl) ? new FirefoxAdapter(api) : new ChromeAdapter(api);
}
