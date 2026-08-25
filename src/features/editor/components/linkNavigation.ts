const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeExternalHref(value: string) {
  try {
    const url = new URL(value, "https://amanite.local/");
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
