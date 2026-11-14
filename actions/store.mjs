export const STORE_DOMAINS = Object.freeze([
  'walmart.com',
  'kroger.com',
  'instacart.com',
  'amazon.com',
]);

export function isAllowedStoreUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if ([...url.searchParams.keys()].some((key) => /token|secret|password|api[_-]?key|auth/i.test(key))) {
      return false;
    }
    return STORE_DOMAINS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export function isCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return /checkout|payment/i.test(url.href);
  } catch {
    return false;
  }
}

export function getStoreUrl() {
  const value = process.env.GROCERY_STORE_URL;
  return value && isAllowedStoreUrl(value) ? value : null;
}
