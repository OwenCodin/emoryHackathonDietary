import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStoreUrl } from './store.mjs';

const PROFILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '.browser-profile');

async function main() {
  const storeUrl = getStoreUrl();
  if (!storeUrl) {
    throw new Error(
      'Set GROCERY_STORE_URL to an HTTPS URL on Walmart, Kroger, Instacart, or Amazon.',
    );
  }

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    viewport: { width: 1280, height: 720 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(storeUrl, { waitUntil: 'domcontentloaded' });
    process.stdout.write(
      'Sign in directly in the browser. Do not share your password with the agent. Press Ctrl+C here when finished.\n',
    );
    await new Promise((resolve) => process.once('SIGINT', resolve));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Store login browser failed: ${error.message}\n`);
  process.exitCode = 1;
});
