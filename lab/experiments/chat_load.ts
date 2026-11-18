/**
 * WebSocket Chat Broadcast Load Experiment (Experiment E7)
 *
 * Spawns N WebSocket clients (100 to 2000):
 *   - 1 Authenticated Streamer / Chatter sending messages with timestamps: `{"ts": Date.now(), "seq": ...}`
 *   - N - 1 Guest Receivers joining the channel chat room
 *
 * Measures:
 *   - End-to-end delivery latency (p50, p95, p99, max)
 *   - Message drop rate (loss percentage)
 *   - Server CPU and memory consumption sampled via GET /api/debug/stats
 *   - Appends results to `lab/results/chat_load_results.csv`
 *
 * Usage:
 *   pnpm exec tsx lab/experiments/chat_load.ts --clients 100 --messages 20 --interval-ms 200
 */

import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

interface ChatLoadOptions {
  serverUrl: string;
  channelId: string;
  channelName: string;
  numClients: number;
  numMessages: number;
  intervalMs: number;
  outputCsv: string;
}

interface ServerTelemetry {
  timestamp: string;
  cpuPercent: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
  };
  activeWsConnections: number;
}

const CSV_HEADER = [
  'timestamp_iso',
  'clients_n',
  'messages_sent',
  'messages_expected',
  'messages_received',
  'loss_pct',
  'latency_p50_ms',
  'latency_p95_ms',
  'latency_p99_ms',
  'latency_max_ms',
  'server_cpu_pct',
  'server_rss_mb',
  'server_heap_mb',
].join(',');

function parseArgs(): ChatLoadOptions {
  const args = process.argv.slice(2);
  let serverUrl = 'http://localhost:3000';
  let channelId = '99999999-8888-7777-6666-555555555555';
  let channelName = 'loadtest';
  let numClients = 100;
  let numMessages = 20;
  let intervalMs = 200;
  let outputCsv = path.resolve('lab/results/chat_load_results.csv');

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--server' && args[i + 1]) serverUrl = args[++i];
    else if (a === '--channel-id' && args[i + 1]) channelId = args[++i];
    else if (a === '--channel' && args[i + 1]) channelName = args[++i];
    else if ((a === '-n' || a === '--clients') && args[i + 1]) numClients = parseInt(args[++i], 10);
    else if ((a === '-m' || a === '--messages') && args[i + 1]) numMessages = parseInt(args[++i], 10);
    else if (a === '--interval-ms' && args[i + 1]) intervalMs = parseInt(args[++i], 10);
    else if (a === '--output' && args[i + 1]) outputCsv = path.resolve(args[++i]);
  }

  return {
    serverUrl,
    channelId,
    channelName,
    numClients,
    numMessages,
    intervalMs,
    outputCsv,
  };
}

async function fetchGuestTicket(serverUrl: string): Promise<string> {
  const res = await fetch(`${serverUrl}/api/ws-ticket`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to get guest ticket: ${res.statusText}`);
  const data = (await res.json()) as { ticket: string };
  return data.ticket;
}

async function fetchServerStats(serverUrl: string): Promise<ServerTelemetry | null> {
  try {
    const res = await fetch(`${serverUrl}/api/debug/stats`);
    if (!res.ok) return null;
    return (await res.json()) as ServerTelemetry;
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

async function connectSocket(
  wsUrl: string,
  channelId: string
): Promise<{ ws: WebSocket; latencies: number[] }> {
  const ws = new WebSocket(wsUrl);
  const latencies: number[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 8000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Join channel chat room
  ws.send(JSON.stringify({ t: 'chat.join', d: { channelId } }));

  ws.on('message', (raw) => {
    const now = Date.now();
    try {
      const msg = JSON.parse(raw.toString()) as { t: string; d?: { text?: string } };
      if (msg.t === 'chat.message' && msg.d?.text) {
        // Message format: [load_seq=XX ts=1700000000000]
        const m = msg.d.text.match(/ts=(\d+)/);
        if (m) {
          const sentTs = parseInt(m[1], 10);
          const lat = Math.max(0, now - sentTs);
          latencies.push(lat);
        }
      }
    } catch {
      // ignore
    }
  });

  return { ws, latencies };
}

async function main() {
  const opts = parseArgs();
  console.log('====================================================');
  console.log('NetStream WebSocket Chat Load Benchmark (E7)');
  console.log('====================================================');
  console.log(`Server URL       : ${opts.serverUrl}`);
  console.log(`Channel ID       : ${opts.channelId}`);
  console.log(`Target Clients N : ${opts.numClients}`);
  console.log(`Messages to send : ${opts.numMessages}`);
  console.log(`Interval         : ${opts.intervalMs} ms`);
  console.log('====================================================');

  const wsProto = opts.serverUrl.startsWith('https') ? 'wss:' : 'ws:';
  const host = new URL(opts.serverUrl).host;

  console.log(`Connecting ${opts.numClients} WebSocket clients in parallel...`);
  const sockets: WebSocket[] = [];
  const clientLatencies: number[][] = [];

  // Batch ticket acquisition and connection
  const batchSize = 25;
  for (let i = 0; i < opts.numClients; i += batchSize) {
    const chunkCount = Math.min(batchSize, opts.numClients - i);
    const chunkPromises = Array.from({ length: chunkCount }, async () => {
      const ticket = await fetchGuestTicket(opts.serverUrl);
      const wsUrl = `${wsProto}//${host}/ws?ticket=${encodeURIComponent(ticket)}`;
      return await connectSocket(wsUrl, opts.channelId);
    });

    const connected = await Promise.all(chunkPromises);
    for (const c of connected) {
      sockets.push(c.ws);
      clientLatencies.push(c.latencies);
    }
    process.stdout.write(`\rConnected ${sockets.length}/${opts.numClients} clients...`);
  }
  console.log('\nAll clients connected and joined chat room.');

  // Let connections stabilize
  await new Promise((r) => setTimeout(r, 1000));

  const initialStats = await fetchServerStats(opts.serverUrl);
  if (initialStats) {
    console.log(
      `Initial server stats: CPU=${initialStats.cpuPercent}% RSS=${initialStats.memory.rssMb}MB Conns=${initialStats.activeWsConnections}`
    );
  }

  // Sender socket
  const senderTicket = await fetchGuestTicket(opts.serverUrl);
  const senderWsUrl = `${wsProto}//${host}/ws?ticket=${encodeURIComponent(senderTicket)}`;
  const sender = (await connectSocket(senderWsUrl, opts.channelId)).ws;

  console.log(`Sending ${opts.numMessages} broadcast messages...`);
  for (let seq = 1; seq <= opts.numMessages; seq++) {
    const text = `[load_seq=${seq} ts=${Date.now()}] test-load`;
    sender.send(JSON.stringify({ t: 'chat.send', d: { channelId: opts.channelId, text } }));
    if (opts.intervalMs > 0 && seq < opts.numMessages) {
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
  }

  // Wait 1.5s for trailing deliveries
  await new Promise((r) => setTimeout(r, 1500));

  const finalStats = await fetchServerStats(opts.serverUrl);
  sender.close();
  for (const s of sockets) {
    s.close();
  }

  // Aggregate results across all receivers
  const allLatencies: number[] = [];
  let totalReceived = 0;
  for (const list of clientLatencies) {
    totalReceived += list.length;
    allLatencies.push(...list);
  }

  const expectedDeliveries = opts.numClients * opts.numMessages;
  const missing = Math.max(0, expectedDeliveries - totalReceived);
  const lossPct = expectedDeliveries > 0 ? (missing / expectedDeliveries) * 100 : 0;

  const p50 = percentile(allLatencies, 50);
  const p95 = percentile(allLatencies, 95);
  const p99 = percentile(allLatencies, 99);
  const maxLat = allLatencies.length > 0 ? Math.max(...allLatencies) : 0;

  console.log('\n=== Benchmark Results ===');
  console.log(`Deliveries       : ${totalReceived} / ${expectedDeliveries} expected`);
  console.log(`Message Loss     : ${lossPct.toFixed(2)}%`);
  console.log(
    `Latency (ms)     : p50=${p50.toFixed(1)}ms | p95=${p95.toFixed(1)}ms | p99=${p99.toFixed(1)}ms | max=${maxLat.toFixed(1)}ms`
  );
  if (finalStats) {
    console.log(
      `Server Telemetry : CPU=${finalStats.cpuPercent}% | RSS=${finalStats.memory.rssMb}MB | Heap=${finalStats.memory.heapUsedMb}MB`
    );
  }

  // Append to CSV
  fs.mkdirSync(path.dirname(opts.outputCsv), { recursive: true });
  const writeHeader = !fs.existsSync(opts.outputCsv) || fs.statSync(opts.outputCsv).size === 0;
  const row = [
    new Date().toISOString(),
    opts.numClients,
    opts.numMessages,
    expectedDeliveries,
    totalReceived,
    lossPct.toFixed(2),
    p50.toFixed(2),
    p95.toFixed(2),
    p99.toFixed(2),
    maxLat.toFixed(2),
    finalStats?.cpuPercent ?? '',
    finalStats?.memory.rssMb ?? '',
    finalStats?.memory.heapUsedMb ?? '',
  ].join(',');

  fs.appendFileSync(opts.outputCsv, (writeHeader ? `${CSV_HEADER}\n` : '') + `${row}\n`, 'utf8');
  console.log(`Results logged to ${opts.outputCsv}`);
}

void main().catch((err) => {
  console.error('Chat load runner failed:', err);
  process.exit(1);
});
