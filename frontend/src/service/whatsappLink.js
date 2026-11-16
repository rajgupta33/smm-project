/**
 * Helpers ported from `whatsapp-mobile-sender-googel-sheet` for parsing
 * WhatsApp links and building mobile-native launch URLs (WhatsApp app,
 * WhatsApp Business on Android, or the original web link).
 */

export const WA_OPEN_MODES = [
  { value: 'app', label: 'WhatsApp app (Mobile)' },
  { value: 'business', label: 'WhatsApp Business (Android)' },
  { value: 'link', label: 'Web / Original link' },
];

export function defaultWhatsAppOpenMode() {
  try {
    const saved = localStorage.getItem('wa_open_mode');
    if (saved === 'app' || saved === 'business' || saved === 'link') return saved;
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
    return 'app';
  }
  return 'link';
}

export function saveWhatsAppOpenMode(mode) {
  try {
    localStorage.setItem('wa_open_mode', mode);
  } catch {
    // Ignore storage failures.
  }
}

export function parseWhatsAppLink(link) {
  try {
    const url = new URL(String(link || '').trim());
    let phone = url.searchParams.get('phone');
    if (!phone && /(^|\.)wa\.me$/i.test(url.hostname)) {
      phone = url.pathname;
    }
    return {
      phone: String(phone || '').replace(/\D/g, ''),
      text: url.searchParams.get('text') || '',
    };
  } catch {
    return null;
  }
}

export function buildWhatsAppTargetUrl(link, openMode = 'link') {
  const parsed = parseWhatsAppLink(link);
  if (!parsed || !parsed.phone || openMode === 'link') return link;
  const query = `phone=${parsed.phone}&text=${encodeURIComponent(parsed.text)}`;
  if (openMode === 'business') {
    return `intent://send?${query}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`;
  }
  return `whatsapp://send?${query}`;
}
