const VIEWER = chrome.runtime.getURL('viewer.html');

async function isEnabled(): Promise<boolean> {
  const { settings } = await chrome.storage.local.get('settings');
  return (settings as { autoIntercept?: boolean } | undefined)?.autoIntercept ?? true;
}

function isPdfResponse(d: chrome.webRequest.OnHeadersReceivedDetails): boolean {
  if (d.statusCode < 200 || d.statusCode >= 300) return false;
  const h = (n: string) => d.responseHeaders?.find((x) => x.name.toLowerCase() === n)?.value?.toLowerCase() ?? '';
  const ct = h('content-type');
  const cd = h('content-disposition');
  if (cd.startsWith('attachment')) return false;
  if (ct.includes('application/pdf')) return true;
  return ct.includes('application/octet-stream') && /\.pdf($|[?#])/i.test(d.url);
}

const openViewer = (tabId: number, url: string) =>
  chrome.tabs.update(tabId, { url: `${VIEWER}?file=${encodeURIComponent(url)}` });

async function redirectIfEnabled(tabId: number, url: string) {
  if (await isEnabled()) await openViewer(tabId, url);
}

// Redirect http(s) PDFs to our viewer (Edge's built-in viewer is closed to extensions).
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId >= 0 && isPdfResponse(d)) void redirectIfEnabled(d.tabId, d.url);
    return undefined;
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders'],
);

// Local file:// PDFs (requires "Allow access to file URLs").
chrome.tabs.onUpdated.addListener((tabId, info) => {
  const url = info.url;
  if (url && /^file:\/\/.*\.pdf$/i.test(url.split(/[?#]/)[0])) {
    void redirectIfEnabled(tabId, url);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  const url = tab.url ?? '';
  if (tab.id !== undefined && /^(https?|file):/.test(url) && /\.pdf($|[?#])/i.test(url)) {
    await openViewer(tab.id, url);
  } else {
    await chrome.tabs.create({ url: VIEWER });
  }
});

chrome.runtime.onInstalled.addListener((d) => {
  chrome.contextMenus.create({
    id: 'open-link-in-explorer',
    title: 'Open PDF in AI Explorer',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', 'file:///*.pdf'],
  });
  if (d.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-link-in-explorer' && info.linkUrl) {
    void chrome.tabs.create({ url: `${VIEWER}?file=${encodeURIComponent(info.linkUrl)}` });
  }
});
