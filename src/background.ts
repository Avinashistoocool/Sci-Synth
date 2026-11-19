import { PDF_LINK_PATTERNS, looksLikePdfUrl, viewerUrl } from './lib/pdfUrl';

// The browser's built-in PDF viewer stays the default. Sci-Synth opens a PDF only when the user
// asks for it (toolbar icon, context menu) or when the user put the site on the allowlist.

const MENU_LINK = 'open-link-in-scisynth';
const MENU_PAGE = 'open-page-in-scisynth';

function hostKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.protocol}//${u.hostname}` : null;
  } catch {
    return null;
  }
}

async function allowlist(): Promise<string[]> {
  const { settings } = await chrome.storage.local.get('settings');
  const list = (settings as { siteAllowlist?: unknown } | undefined)?.siteAllowlist;
  return Array.isArray(list) ? (list as string[]) : [];
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

const openInTab = (tabId: number, url: string) => chrome.tabs.update(tabId, { url: viewerUrl(url) });

async function onHeaders(d: chrome.webRequest.OnHeadersReceivedDetails) {
  if (d.tabId < 0 || !isPdfResponse(d)) return;
  const key = hostKey(d.url);
  if (key && (await allowlist()).includes(key)) await openInTab(d.tabId, d.url);
}

// webRequest is an optional permission. It is requested only when the user adds a site to the
// allowlist, and events fire only for hosts the user granted. Without it, nothing is intercepted.
let listening = false;
function listenIfPermitted() {
  if (listening || !chrome.webRequest?.onHeadersReceived) return;
  chrome.webRequest.onHeadersReceived.addListener(
    (d) => {
      void onHeaders(d);
      return undefined;
    },
    { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
    ['responseHeaders'],
  );
  listening = true;
}
listenIfPermitted();
chrome.permissions.onAdded.addListener(listenIfPermitted);

/** Toolbar icon: open the current PDF in Sci-Synth, or an empty viewer on other pages. */
async function openFromTab(tab: chrome.tabs.Tab) {
  const url = tab.url ?? '';
  if (tab.id !== undefined && looksLikePdfUrl(url)) await openInTab(tab.id, url);
  else await chrome.tabs.create({ url: viewerUrl(), index: tab.index !== undefined ? tab.index + 1 : undefined });
}

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  if (info.menuItemId === MENU_LINK && info.linkUrl) {
    await chrome.tabs.create({ url: viewerUrl(info.linkUrl), index: tab ? tab.index + 1 : undefined });
  } else if (info.menuItemId === MENU_PAGE) {
    const url = info.frameUrl && looksLikePdfUrl(info.frameUrl) ? info.frameUrl : info.pageUrl;
    if (!url) return;
    if (tab?.id !== undefined) await openInTab(tab.id, url);
    else await chrome.tabs.create({ url: viewerUrl(url) });
  }
}

chrome.action.onClicked.addListener((tab) => void openFromTab(tab));
chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: 'Open in Sci-Synth',
      contexts: ['link'],
      targetUrlPatterns: PDF_LINK_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: 'Open this PDF in Sci-Synth',
      contexts: ['page', 'frame'],
      documentUrlPatterns: PDF_LINK_PATTERNS,
    });
  });
});

// Entry points for automated tests (the UI paths above call the same functions).
Object.assign(globalThis, { sciSynth: { openFromTab, onMenuClick, MENU_LINK, MENU_PAGE } });
