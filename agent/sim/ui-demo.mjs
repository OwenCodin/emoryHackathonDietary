import { createServer } from 'node:http';
import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../../shared/video.mjs';
import { createScreen } from '../screen.mjs';

const port = Number(process.env.UI_DEMO_PORT) || 4173;
const screen = createScreen({ log: message => console.error(message) });
const examples = [
  {
    state: 'idle',
    event: { type: 'summary', meters: [
      { key: 'potassium', label: 'Potassium', used: 740, limit: 2400, unit: 'mg' },
      { key: 'phosphorus', label: 'Phosphorus', used: 480, limit: 1000, unit: 'mg' },
      { key: 'sodium', label: 'Sodium', used: 980, limit: 2000, unit: 'mg' },
      { key: 'fluid', label: 'Fluid', used: 860, limit: 1800, unit: 'ml' },
    ] },
  },
  { state: 'listening', event: { type: 'summary', meters: [] } },
  {
    state: 'looking',
    event: { type: 'verdict', verdict: 'yes', food: 'Fresh blueberries', reason: 'Example reason supplied by the demo event.', nutrients: [{ label: 'Potassium', level: 'low' }] },
  },
  {
    state: 'thinking',
    event: { type: 'verdict', verdict: 'caution', food: 'Vegetable soup', reason: 'Example reason supplied by the demo event.', alternative: 'A lower-sodium option' },
  },
  {
    state: 'speaking',
    event: { type: 'verdict', verdict: 'no', food: 'Salted snack mix', reason: 'Example reason supplied by the demo event.', nutrients: [{ label: 'Sodium', level: 'high' }] },
  },
  { state: 'idle', event: { type: 'note', heading: 'A helpful note', body: 'Example informational text supplied by the demo event.', icon: 'info' } },
  {
    state: 'listening',
    event: { type: 'cart', items: [{ name: 'Apples', qty: '2' }, { name: 'Plain rice', qty: '1 bag' }, { name: 'Frozen berries', qty: '1' }, { name: 'Unsalted crackers', qty: '1 box' }, { name: 'Olive oil', qty: '1 bottle' }, { name: 'Oats', qty: '1' }], estimatedTotal: '$18.40', status: 'confirming' },
  },
];

let index = 0;
let frameNumber = 0;
const applyExample = () => {
  const example = examples[index];
  screen.setState(example.state);
  screen.dispatchPanelEvent(example.event);
  index = (index + 1) % examples.length;
};
applyExample();
const cycle = setInterval(applyExample, 3500);

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RenaLine UI demo</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #09121c; color: #e8eef3; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 1120px); }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    p { margin: 0 0 16px; color: #b6c4cf; font-size: 14px; }
    img { display: block; width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; background: #0b1420; object-fit: contain; }
  </style>
</head>
<body>
  <main>
    <h1>RenaLine call UI · demo only</h1>
    <p>Cycles through every agent state and panel type using sample values. No live call or patient data is used.</p>
    <img id="frame" alt="Animated RenaLine UI preview">
  </main>
  <script>
    const image = document.querySelector('#frame');
    let frame = 0;
    const refresh = () => { image.src = '/frame.png?frame=' + frame++; };
    refresh();
    setInterval(refresh, 250);
  </script>
</body>
</html>`;

const server = createServer(async (request, response) => {
  if (request.url?.split('?')[0] === '/frame.png') {
    try {
      const pixels = screen.frame(frameNumber++);
      const png = await sharp(Buffer.from(pixels), {
        raw: { width: WIDTH, height: HEIGHT, channels: 4 },
      }).png().toBuffer();
      response.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'no-store',
        'content-length': png.length,
      });
      response.end(png);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Preview frame failed: ${error?.message ?? 'unknown error'}`);
    }
    return;
  }
  if (request.url?.split('?')[0] !== '/') {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`UI demo ready at http://127.0.0.1:${port}`);
});

server.on('close', () => {
  clearInterval(cycle);
  screen.close();
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
