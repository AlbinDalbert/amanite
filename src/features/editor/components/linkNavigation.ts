const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeExternalHref(value: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value.trim())) return null;
  try {
    const url = new URL(value);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
