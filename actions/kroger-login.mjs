// One-time Kroger sign-in, run by a person: node --env-file=.env.local actions/kroger-login.mjs
// Two modes. With KROGER_RELAY_URL and KROGER_RELAY_SECRET set it prints (and opens) a sign-in link that goes
// through the public relay (kroger-relay/), then waits for the relay to hold the code and exchanges it locally.
// Otherwise it opens Kroger's sign-in page, waits for the redirect on localhost, checks the state value,
// exchanges the code and saves the refresh token outside the repo. The code and tokens are never printed.
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  buildAuthorizeUrl,
  createKrogerClient,
  createTokenStore,
  readKrogerConfig,
} from './kroger.mjs';
import { createKrogerSignIn, readRelayConfig } from './kroger-signin.mjs';

const TIMEOUT_MS = 5 * 60 * 1000;

function die(message) {
  console.error(message);
  process.exit(1);
}

const config = readKrogerConfig(process.env);
if (!config) die('Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in .env.local first.');

if (readRelayConfig(process.env)) {
  // unrefTimers:false keeps this process alive while it waits; the agent's timers are unref'd.
  const signIn = createKrogerSignIn({ unrefTimers: false });
  const started = await signIn.startKrogerSignIn();
  if (!started.ok) die(`Could not start the sign-in (${started.error}).`);
  console.log('Open this link on your phone (or here) and sign in to Kroger:');
  console.log(started.link);
  if (process.platform === 'darwin') execFile('open', [started.link], () => {});
  const outcome = await signIn.waitForKrogerSignIn();
  if (outcome.ok) {
    console.log('Kroger sign-in saved.');
    process.exit(0);
  }
  die(`Kroger sign-in did not finish (${outcome.error}).`);
}

let redirect;
try {
  redirect = new URL(config.redirectUri);
} catch {
  die('KROGER_REDIRECT_URI is not a valid URL.');
}
if (
  redirect.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(redirect.hostname) ||
  !redirect.port
) {
  die('KROGER_REDIRECT_URI must be http://localhost:<port>/<path> (or 127.0.0.1) with an explicit port.');
}

const state = randomBytes(16).toString('hex');
const client = createKrogerClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  locationId: config.locationId,
  tokenStore: createTokenStore({ dir: config.tokenDir }),
});

const sameState = (given) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirect.origin);
  if (req.method !== 'GET' || url.pathname !== redirect.pathname) {
    res.writeHead(404).end('Not found');
    return;
  }
  const reply = (code, text) => res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
  const finish = (code) => server.close(() => process.exit(code));

  if (url.searchParams.has('error')) {
    reply(400, 'Kroger sign-in was not completed.');
    console.error(`Kroger returned an error: ${url.searchParams.get('error')?.slice(0, 40)}`);
    finish(1);
    return;
  }
  if (!sameState(url.searchParams.get('state'))) {
    reply(400, 'Sign-in check failed.');
    console.error('State mismatch; sign-in abandoned.');
    finish(1);
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    reply(400, 'No sign-in code received.');
    console.error('No code in the redirect.');
    finish(1);
    return;
  }
  const result = await client.exchangeCode({ code, redirectUri: config.redirectUri });
  if (!result.ok) {
    reply(500, 'Kroger sign-in could not be saved.');
    console.error(`Could not complete the sign-in (${result.error}).`);
    finish(1);
    return;
  }
  reply(200, 'Kroger sign-in saved. You can close this tab.');
  console.log('Kroger sign-in saved.');
  finish(0);
});

server.on('error', () => die(`Could not listen on ${redirect.host}; is the port already in use?`));

server.listen(Number(redirect.port), redirect.hostname, () => {
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
  console.log('Sign in to Kroger in your browser. If it does not open, visit:');
  console.log(authorizeUrl);
  if (process.platform === 'darwin') execFile('open', [authorizeUrl], () => {});
});

setTimeout(() => die('Timed out waiting for the Kroger sign-in (5 minutes).'), TIMEOUT_MS).unref();
