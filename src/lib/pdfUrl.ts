/** URL heuristics shared by the background worker and the viewer. */

export const VIEWER_PATH = 'viewer.html';

export function viewerUrl(file?: string): string {
  const base = chrome.runtime.getURL(VIEWER_PATH);
  return file ? `${base}?file=${encodeURIComponent(file)}` : base;
}

/** True when the URL path looks like a PDF (".pdf" suffix, or an arXiv/OpenReview-style "/pdf/" path). */
export function looksLikePdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^(https?|file):$/.test(u.protocol)) return false;
    const path = u.pathname.toLowerCase();
    return path.endsWith('.pdf') || /\/pdf\/[^/]+$/.test(path) || (path.endsWith('/pdf') && u.search.length > 1);
  } catch {
    return false;
  }
}

export const PDF_LINK_PATTERNS = [
  '*://*/*.pdf',
  '*://*/*.pdf?*',
  '*://*/*.PDF',
  '*://*/pdf/*',
  'file:///*.pdf',
  'file:///*.PDF',
];
