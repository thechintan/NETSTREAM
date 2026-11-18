/**
 * Automated WebRTC Multi-Viewer Experiment Tool (Experiment E2 / E3 / E5 / E6 / E8)
 *
 * Launches N headless Chromium viewer instances using Playwright with fake media devices,
 * monitors connection state, samples WebRTC metrics every second via `window.__stats`,
 * and logs per-viewer CSV time series to `lab/results/viewers_<scenario>.csv`.
 *
 * Optional: `--auto-publish` opens an automated publisher tab in Creator Studio
 * so the entire stream + viewer experiment runs end-to-end without manual setup.
 *
 * Usage:
 *   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 30
 *   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 5 -t 45 --auto-publish
 */

import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

interface ViewerOptions {
  channelUrl: string;
  numViewers: number;
  durationSeconds: number;
  autoPublish: boolean;
  scenarioLabel: string;
  outputCsv: string;
  headless: boolean;
}

const CSV_HEADER = [
  'timestamp_iso',
  'scenario',
  'viewer_id',
  'elapsed_s',
  'bitrate_kbps',
  'fps',
  'width',
  'height',
  'packets_lost',
  'loss_pct',
  'jitter_ms',
  'freeze_count',
  'nack_count',
  'pli_count',
  'rtt_ms',
  'candidate_type',
  'protocol',
  'layer',
].join(',');

function parseArgs(): ViewerOptions {
  const args = process.argv.slice(2);
  let channelUrl = 'http://localhost:5173/c/testuser';
  let numViewers = 3;
  let durationSeconds = 30;
  let autoPublish = false;
  let scenarioLabel = 'default-run';
  let outputCsv = '';
  let headless = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-c' || arg === '--channel') && args[i + 1]) {
      channelUrl = args[++i];
    } else if ((arg === '-n' || arg === '--viewers') && args[i + 1]) {
      numViewers = parseInt(args[++i], 10);
    } else if ((arg === '-t' || arg === '--duration') && args[i + 1]) {
      durationSeconds = parseInt(args[++i], 10);
    } else if (arg === '--auto-publish') {
      autoPublish = true;
    } else if (arg === '--scenario' && args[i + 1]) {
      scenarioLabel = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      outputCsv = args[++i];
    } else if (arg === '--no-headless') {
      headless = false;
    }
  }

  if (!outputCsv) {
    outputCsv = path.resolve('lab/results', `viewers_${scenarioLabel}_${Date.now()}.csv`);
  }

  return {
    channelUrl,
    numViewers,
    durationSeconds,
    autoPublish,
    scenarioLabel,
    outputCsv: path.resolve(outputCsv),
    headless,
  };
}

async function startAutomatedPublisher(browser: Browser, channelUrl: string): Promise<Page> {
  const parsed = new URL(channelUrl);
  const studioUrl = `${parsed.protocol}//${parsed.host}/studio`;

  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();

  console.log(`[Publisher] Navigating to Studio: ${studioUrl}`);
  await page.goto(studioUrl, { waitUntil: 'domcontentloaded' });

  // If prompted to log in, fill default demo credentials
  const isLoginPage = await page.locator('input[type="password"]').count();
  if (isLoginPage > 0) {
    console.log('[Publisher] Logging in with demo credentials...');
    await page.fill('input[type="text"], input[type="email"]', 'testuser');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/studio', { timeout: 10000 });
  }

  // Wait for preview stream and click "Go Live"
  console.log('[Publisher] Waiting for media preview stream...');
  await page.waitForTimeout(2000);

  const goLiveBtn = page.locator('button:has-text("Go Live")');
  if (await goLiveBtn.count()) {
    console.log('[Publisher] Clicking "Go Live"...');
    await goLiveBtn.click();
    await page.waitForSelector('span:has-text("Live")', { timeout: 15000 });
    console.log('[Publisher] Stream is LIVE!');
  }

  return page;
}

async function runViewer(
  browser: Browser,
  viewerIdx: number,
  options: ViewerOptions,
  csvRows: string[]
): Promise<void> {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  const viewerId = `viewer-${String(viewerIdx + 1).padStart(2, '0')}`;

  console.log(`[${viewerId}] Opening channel: ${options.channelUrl}`);
  await page.goto(options.channelUrl, { waitUntil: 'domcontentloaded' });

  // Open Stats overlay via 'S' hotkey if not already open
  await page.keyboard.press('s');

  const startTime = Date.now();
  const endTime = startTime + options.durationSeconds * 1000;
  let sampleCount = 0;

  while (Date.now() < endTime) {
    await page.waitForTimeout(1000);
    sampleCount++;

    try {
      const stats = await page.evaluate(async () => {
        if (window.__stats && typeof window.__stats.getSnapshot === 'function') {
          return await window.__stats.getSnapshot();
        }
        return null;
      });

      if (stats) {
        const row = [
          stats.timestampIso,
          options.scenarioLabel,
          viewerId,
          sampleCount,
          stats.bitrateKbps ?? '',
          stats.fps ?? '',
          stats.width ?? '',
          stats.height ?? '',
          stats.packetsLost ?? '',
          stats.lossPct ?? '',
          stats.jitterMs ?? '',
          stats.freezeCount ?? '',
          stats.nackCount ?? '',
          stats.pliCount ?? '',
          stats.rttMs ?? '',
          stats.candidateType ?? '',
          stats.protocol ?? '',
          stats.layer ?? '',
        ].join(',');

        csvRows.push(row);
      }
    } catch {
      // Ignore evaluation errors during page teardown
    }
  }

  console.log(`[${viewerId}] Finished (${sampleCount} stats samples recorded)`);
  await context.close();
}

async function main() {
  const opts = parseArgs();
  console.log('====================================================');
  console.log('NetStream Multi-Viewer Playwright Runner');
  console.log('====================================================');
  console.log(`Channel URL      : ${opts.channelUrl}`);
  console.log(`Viewers          : ${opts.numViewers}`);
  console.log(`Duration         : ${opts.durationSeconds}s`);
  console.log(`Auto Publish     : ${opts.autoPublish}`);
  console.log(`Scenario         : ${opts.scenarioLabel}`);
  console.log(`Output CSV       : ${opts.outputCsv}`);
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: opts.headless,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  let publisherPage: Page | null = null;
  const csvRows: string[] = [CSV_HEADER];

  try {
    if (opts.autoPublish) {
      publisherPage = await startAutomatedPublisher(browser, opts.channelUrl);
      console.log('Publisher ready. Waiting 3s before spawning viewers...');
      await new Promise((r) => setTimeout(r, 3000));
    }

    console.log(`Spawning ${opts.numViewers} concurrent viewers...`);
    const viewerPromises = Array.from({ length: opts.numViewers }, (_, idx) =>
      runViewer(browser, idx, opts, csvRows)
    );

    await Promise.all(viewerPromises);

    fs.mkdirSync(path.dirname(opts.outputCsv), { recursive: true });
    fs.writeFileSync(opts.outputCsv, csvRows.join('\n') + '\n', 'utf8');
    console.log(`\nSUCCESS: Wrote ${csvRows.length - 1} rows to ${opts.outputCsv}`);
  } finally {
    if (publisherPage) {
      try {
        await publisherPage.context().close();
      } catch {
        // ignore
      }
    }
    await browser.close();
  }
}

void main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
