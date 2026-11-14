const API_URL = 'https://connect.dev.instacart.tools/idp/v1/products/products_link';

export async function createInstacartLink({
  items,
  apiKey = process.env.INSTACART_API_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) return { ok: false, error: 'INSTACART_API_KEY is required for the fallback' };
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'At least one cart item is required' };
  }

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Renal dietitian grocery list',
        link_type: 'shopping_list',
        expires_in: 7,
        instructions: [
          'Review each product and choose a suitable store before adding anything to a cart.',
          'Prefer low-sodium or unsalted options when available.',
        ],
        line_items: items.map((item) => ({
          name: item.name,
          display_text: `${item.quantity} ${item.name}`,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'Instacart shopping-list request failed' };
  }

  if (!response.ok) {
    return { ok: false, error: `Instacart rejected the shopping list (HTTP ${response.status})` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Instacart returned an unreadable shopping-list response' };
  }

  const url = body.products_link_url ?? body.url ?? body.data?.products_link_url ?? body.data?.url;
  if (typeof url !== 'string') {
    return { ok: false, error: 'Instacart did not return a shopping-list URL' };
  }

  try {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.protocol !== 'https:' ||
      !(parsedUrl.hostname === 'instacart.com' || parsedUrl.hostname.endsWith('.instacart.com'))
    ) {
      return { ok: false, error: 'Instacart returned an unsupported shopping-list URL' };
    }
  } catch {
    return { ok: false, error: 'Instacart returned an invalid shopping-list URL' };
  }

  return { ok: true, url };
}
