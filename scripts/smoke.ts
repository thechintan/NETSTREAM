import WebSocket from '../apps/server/node_modules/ws/index.js';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const WS_BASE = process.env.WS_URL || 'ws://localhost:3000/ws';
const ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

function log(step: string, msg: string) {
  console.log(`[SMOKE] [${step}] ${msg}`);
}

function fail(step: string, err: unknown): never {
  console.error(`[SMOKE] [FAIL] at ${step}:`, err);
  process.exit(1);
}

// Helper for HTTP requests
async function http(path: string, options: RequestInit = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Helper to send WS request and wait for matching ack
function wsRequest<T = unknown>(
  ws: WebSocket,
  t: string,
  d: unknown,
  timeoutMs = 5000
): Promise<{ id: string; d: T }> {
  const id = `req_${Math.random().toString(36).slice(2, 9)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timeout waiting for ack on ${t} (${id})`));
    }, timeoutMs);

    const onMessage = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.t === 'ack' && msg.id === id) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve({ id, d: msg.d as T });
        } else if (msg.t === 'error' && msg.id === id) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          reject(new Error(`Server error on ${t}: ${JSON.stringify(msg.d)}`));
        }
      } catch {
        // ignore parse error
      }
    };

    ws.on('message', onMessage);
    ws.send(JSON.stringify({ t, id, d }));
  });
}

async function main() {
  console.log('=== NetStream Live Backend Smoke Test ===\n');

  // 1. Health check
  log('1. Health', 'Checking /api/health...');
  const health = await http('/api/health');
  if (!health.ok || !health.data?.ok || !health.data?.db || !health.data?.redis) {
    fail('Health check', `Unhealthy response: ${JSON.stringify(health.data)}`);
  }
  log('1. Health', `Server healthy! DB: ${health.data.db}, Redis: ${health.data.redis}, Version: ${health.data.version}`);

  // 2. Register User 1 & User 2
  const rand = Math.random().toString(36).slice(2, 8);
  const user1Data = {
    username: `smoke_u1_${rand}`,
    email: `smoke_u1_${rand}@test.local`,
    password: 'Password123!',
  };
  const user2Data = {
    username: `smoke_u2_${rand}`,
    email: `smoke_u2_${rand}@test.local`,
    password: 'Password123!',
  };

  log('2. Register', `Registering User 1: ${user1Data.username}...`);
  const reg1 = await http('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(user1Data),
  });
  const token1 = (reg1.data?.accessToken || reg1.data?.token) as string;
  if (reg1.status !== 201 || !token1) {
    fail('Register User 1', reg1.data);
  }
  const user1 = reg1.data.user;

  log('2. Register', `Registering User 2: ${user2Data.username}...`);
  const reg2 = await http('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(user2Data),
  });
  const token2 = (reg2.data?.accessToken || reg2.data?.token) as string;
  if (reg2.status !== 201 || !token2) {
    fail('Register User 2', reg2.data);
  }
  const _user2 = reg2.data.user;

  // Retrieve User 1's channel ID
  log('2. Channel', `Fetching channel for ${user1.username}...`);
  const chanRes = await http(`/api/channels/${user1.username}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  if (!chanRes.ok || !chanRes.data?.id) {
    fail('Get Channel', chanRes.data);
  }
  const channel1 = chanRes.data;
  log('2. Channel', `Found channel id: ${channel1.id}`);

  // 3. Obtain WS tickets
  log('3. Tickets', 'Requesting one-time WS tickets for both users...');
  const tkt1Res = await http('/api/ws-ticket', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token1}` },
  });
  if (!tkt1Res.ok || !tkt1Res.data?.ticket) {
    fail('WS Ticket User 1', tkt1Res.data);
  }

  const tkt2Res = await http('/api/ws-ticket', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token2}` },
  });
  if (!tkt2Res.ok || !tkt2Res.data?.ticket) {
    fail('WS Ticket User 2', tkt2Res.data);
  }
  const ticket1 = tkt1Res.data.ticket as string;
  const ticket2 = tkt2Res.data.ticket as string;
  log('3. Tickets', 'Tickets acquired successfully.');

  // 4. Open WebSocket connections
  log('4. WebSockets', 'Opening WebSocket connections to /ws...');
  const ws1 = new WebSocket(`${WS_BASE}?ticket=${ticket1}`, {
    headers: { Origin: ORIGIN },
  });
  const ws2 = new WebSocket(`${WS_BASE}?ticket=${ticket2}`, {
    headers: { Origin: ORIGIN },
  });

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      ws1.on('open', resolve);
      ws1.on('error', reject);
    }),
    new Promise<void>((resolve, reject) => {
      ws2.on('open', resolve);
      ws2.on('error', reject);
    }),
  ]);
  log('4. WebSockets', 'Both WebSocket connections established (HTTP 101 Upgrade verified).');

  // 5. Both join channel chat
  log('5. Chat Join', `Joining chat room for channel ${channel1.id}...`);
  const join1 = await wsRequest<{ messages: unknown[] }>(ws1, 'chat.join', {
    channelId: channel1.id,
  });
  const join2 = await wsRequest<{ messages: unknown[] }>(ws2, 'chat.join', {
    channelId: channel1.id,
  });

  if (!Array.isArray(join1.d.messages) || !Array.isArray(join2.d.messages)) {
    fail('Chat Join', 'Invalid chat.join response structure');
  }
  log('5. Chat Join', 'Both users joined chat room successfully.');

  // 6. User 1 sends message, User 2 receives it
  const messageText = `Smoke test live message at ${Date.now()}`;
  log('6. Chat Delivery', `User 1 sending message: "${messageText}"...`);

  const deliveryPromise = new Promise<{ mid: string; text: string; user: { name: string } }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        ws2.off('message', onMsg);
        reject(new Error('Timed out waiting for chat.message delivery to User 2'));
      }, 5000);

      const onMsg = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'chat.message') {
            clearTimeout(timer);
            ws2.off('message', onMsg);
            resolve(parsed.d);
          }
        } catch {
          // ignore
        }
      };
      ws2.on('message', onMsg);
    }
  );

  const sendAck = await wsRequest(ws1, 'chat.send', {
    channelId: channel1.id,
    text: messageText,
  });
  log('6. Chat Delivery', `Message acknowledged by server (ack id: ${sendAck.id})`);

  const delivered = await deliveryPromise;
  if (delivered.text !== messageText || delivered.user.name !== user1.username) {
    fail('Chat Delivery', `Delivered message mismatch: ${JSON.stringify(delivered)}`);
  }
  log('6. Chat Delivery', `Message successfully delivered to User 2! (mid: ${delivered.mid})`);

  // 7. Check /api/live and /api/channels/live endpoints
  log('7. Live Directory', 'Checking GET /api/live and /api/channels/live...');
  const liveRes = await http('/api/live');
  if (!liveRes.ok || !Array.isArray(liveRes.data)) {
    fail('Live Directory (/api/live)', liveRes.data);
  }
  const channelsLiveRes = await http('/api/channels/live');
  if (!channelsLiveRes.ok || !Array.isArray(channelsLiveRes.data)) {
    fail('Live Directory (/api/channels/live)', channelsLiveRes.data);
  }
  log('7. Live Directory', `Both /api/live and /api/channels/live responded OK (${liveRes.data.length} channels currently live).`);

  // Cleanup
  ws1.close();
  ws2.close();

  console.log('\n=========================================');
  console.log('✅ ALL BACKEND SMOKE CHECKS PASSED CLEANLY');
  console.log('=========================================\n');
  process.exit(0);
}

main().catch((err) => {
  fail('Unhandled Exception', err);
});
