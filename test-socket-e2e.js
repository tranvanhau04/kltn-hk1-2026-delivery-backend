/**
 * test-socket-e2e.js — Task 9.2: Socket.io Gateway E2E Test
 *
 * Kịch bản nghiệm thu:
 *   1. HTTP POST /api/auth/login → lấy driverToken
 *   2. HTTP POST /api/auth/login → lấy adminToken
 *   3. Khởi tạo adminSocket (auth: adminToken) → join dispatchers room
 *   4. adminSocket lắng nghe sự kiện 'driver_location_updated'
 *   5. Khởi tạo driverSocket (auth: driverToken) → join active_drivers room
 *   6. driverSocket emit('update_location', payload) sau khi kết nối
 *   7. Nếu adminSocket nhận được payload đúng tọa độ → PASS (exit 0)
 *   8. Nếu timeout 5s → FAIL (exit 1)
 *
 * Chạy: node test-socket-e2e.js
 * Yêu cầu: backend đang chạy tại http://localhost:3001
 */

'use strict';

const http = require('http');
const { io } = require('socket.io-client');

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api`;
const SOCKET_URL = BASE_URL;
const TIMEOUT_MS = 5000;

// ─── Test credentials (sửa nếu cần) ────────────────────────────────────────
const DRIVER_CREDENTIALS = {
  email: process.env.DRIVER_EMAIL || 'driver01@smartexpress.vn',
  password: process.env.DRIVER_PASSWORD || '123456',
};
const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL || 'admin@smartexpress.vn',
  password: process.env.ADMIN_PASSWORD || '123456',
};

// ─── Location payload gửi từ driver ─────────────────────────────────────────
const DRIVER_LOCATION_PAYLOAD = {
  latitude: 10.8231,
  longitude: 106.6297,
  batteryLevel: 85,
};

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(color, symbol, msg) {
  console.log(`${color}${BOLD}${symbol}${RESET} ${msg}`);
}
function info(msg) { log(CYAN, '  ℹ', msg); }
function pass(msg) { log(GREEN, '  ✅', msg); }
function fail(msg) { log(RED, '  ❌', msg); }
function warn(msg) { log(YELLOW, '  ⚠', msg); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let rawBody = '';
      res.on('data', (chunk) => { rawBody += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${rawBody}`));
          }
        } catch {
          reject(new Error(`JSON parse error: ${rawBody}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Main Test Runner ─────────────────────────────────────────────────────────
async function runTest() {
  console.log('');
  console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   Task 9.2 — Socket.io Realtime Tracking E2E Test    ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  let driverToken = null;
  let adminToken = null;
  let driverSocket = null;
  let adminSocket = null;
  let testTimeout = null;
  let passed = false;

  // Cleanup helper
  const cleanup = (exitCode) => {
    if (testTimeout) clearTimeout(testTimeout);
    try { driverSocket?.disconnect(); } catch {}
    try { adminSocket?.disconnect(); } catch {}
    console.log('');
    if (exitCode === 0) {
      log(GREEN, '🎉', `${BOLD}TEST PASSED — Task 9.2 Socket.io Gateway hoạt động đúng!${RESET}`);
    } else {
      log(RED, '💥', `${BOLD}TEST FAILED — Xem lỗi bên trên để debug.${RESET}`);
    }
    console.log('');
    process.exit(exitCode);
  };

  // ── STEP 1: Login as DRIVER ────────────────────────────────────────────────
  info(`STEP 1: Đăng nhập với tài khoản DRIVER (${DRIVER_CREDENTIALS.email})...`);
  try {
    const driverLogin = await httpPost(`${API_BASE}/auth/login`, DRIVER_CREDENTIALS);
    driverToken = driverLogin.accessToken;
    pass(`Lấy driverToken thành công (${driverToken.substring(0, 30)}...)`);
  } catch (err) {
    fail(`Đăng nhập DRIVER thất bại: ${err.message || err.code || err}`);
    if (err.code === 'ECONNREFUSED' || !err.message) {
      warn('Không thể kết nối tới server (ECONNREFUSED). Hãy đảm bảo Backend đang chạy (npm run start:dev) trên port 3001.');
    } else {
      warn('Hãy đảm bảo tài khoản driver tồn tại. Thử đổi DRIVER_EMAIL / DRIVER_PASSWORD env vars.');
    }
    cleanup(1);
    return;
  }

  // ── STEP 2: Login as ADMIN/DISPATCHER ─────────────────────────────────────
  info(`STEP 2: Đăng nhập với tài khoản ADMIN (${ADMIN_CREDENTIALS.email})...`);
  try {
    const adminLogin = await httpPost(`${API_BASE}/auth/login`, ADMIN_CREDENTIALS);
    adminToken = adminLogin.accessToken;
    pass(`Lấy adminToken thành công (${adminToken.substring(0, 30)}...)`);
  } catch (err) {
    fail(`Đăng nhập ADMIN thất bại: ${err.message || err.code || err}`);
    if (err.code === 'ECONNREFUSED' || !err.message) {
      warn('Không thể kết nối tới server (ECONNREFUSED). Hãy đảm bảo Backend đang chạy (npm run start:dev) trên port 3001.');
    } else {
      warn('Hãy đảm bảo tài khoản admin tồn tại. Thử đổi ADMIN_EMAIL / ADMIN_PASSWORD env vars.');
    }
    cleanup(1);
    return;
  }

  // ── STEP 3 & 4: Khởi tạo adminSocket + lắng nghe event ───────────────────
  info(`STEP 3: Kết nối adminSocket và đăng ký lắng nghe 'driver_location_updated'...`);

  await new Promise((resolve, reject) => {
    adminSocket = io(SOCKET_URL, {
      auth: { token: adminToken },
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    });

    adminSocket.on('connected', (data) => {
      pass(`adminSocket kết nối thành công → role: ${data.role}, rooms: [${data.rooms?.join(', ')}]`);
      resolve();
    });

    adminSocket.on('connection_error', (err) => {
      fail(`adminSocket bị từ chối: ${err.message}`);
      reject(new Error(err.message));
    });

    adminSocket.on('connect_error', (err) => {
      fail(`adminSocket connect_error: ${err.message}`);
      reject(err);
    });

    adminSocket.on('disconnect', (reason) => {
      if (!passed) warn(`adminSocket disconnected: ${reason}`);
    });

    setTimeout(() => reject(new Error('adminSocket connection timeout')), 4000);
  }).catch((err) => {
    fail(`Không thể kết nối adminSocket: ${err.message}`);
    cleanup(1);
  });

  // Setup listener before driver connects
  const locationReceived = new Promise((resolve) => {
    adminSocket.on('driver_location_updated', (data) => {
      resolve(data);
    });
  });

  // ── STEP 5 & 6: Khởi tạo driverSocket + emit update_location ─────────────
  info(`STEP 4: Kết nối driverSocket và emit 'update_location'...`);

  await new Promise((resolve, reject) => {
    driverSocket = io(SOCKET_URL, {
      auth: { token: driverToken },
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    });

    driverSocket.on('connected', async (data) => {
      pass(`driverSocket kết nối thành công → role: ${data.role}, rooms: [${data.rooms?.join(', ')}]`);

      info(`STEP 5: Gửi update_location payload: lat=${DRIVER_LOCATION_PAYLOAD.latitude}, lng=${DRIVER_LOCATION_PAYLOAD.longitude}...`);

      // Emit with acknowledgement
      driverSocket.emit(
        'update_location',
        DRIVER_LOCATION_PAYLOAD,
        (ack) => {
          if (ack?.success) {
            pass(`Server xác nhận: ${ack.message}`);
          } else {
            warn(`Server ack: ${JSON.stringify(ack)}`);
          }
        }
      );

      resolve();
    });

    driverSocket.on('connection_error', (err) => {
      fail(`driverSocket bị từ chối: ${err.message}`);
      reject(new Error(err.message));
    });

    driverSocket.on('connect_error', (err) => {
      fail(`driverSocket connect_error: ${err.message}`);
      reject(err);
    });

    setTimeout(() => reject(new Error('driverSocket connection timeout')), 4000);
  }).catch((err) => {
    fail(`Không thể kết nối driverSocket: ${err.message}`);
    cleanup(1);
  });

  // ── STEP 7: Kiểm tra adminSocket có nhận được broadcast không ─────────────
  info(`STEP 6: Chờ adminSocket nhận 'driver_location_updated' (timeout: ${TIMEOUT_MS}ms)...`);

  testTimeout = setTimeout(() => {
    if (!passed) {
      fail(`Timeout ${TIMEOUT_MS}ms — adminSocket KHÔNG nhận được 'driver_location_updated'.`);
      fail('Kiểm tra: (1) backend đang chạy? (2) gateway có lỗi không? (3) admin đã vào room dispatchers?');
      cleanup(1);
    }
  }, TIMEOUT_MS);

  // Wait for the broadcast
  const receivedData = await locationReceived;
  passed = true;

  console.log('');
  pass(`adminSocket nhận được 'driver_location_updated' thành công!`);
  console.log(`${GREEN}    📍 latitude  : ${receivedData.latitude}${RESET}`);
  console.log(`${GREEN}    📍 longitude : ${receivedData.longitude}${RESET}`);
  console.log(`${GREEN}    🔋 battery   : ${receivedData.batteryLevel}%${RESET}`);
  console.log(`${GREEN}    👤 driverId  : ${receivedData.driverId}${RESET}`);
  console.log(`${GREEN}    👤 fullName  : ${receivedData.fullName}${RESET}`);
  console.log(`${GREEN}    🆔 logId     : ${receivedData.trackingLogId}${RESET}`);
  console.log(`${GREEN}    🕒 timestamp : ${receivedData.timestamp}${RESET}`);

  // Validate coordinates match what driver sent
  const latMatch = Math.abs(Number(receivedData.latitude) - DRIVER_LOCATION_PAYLOAD.latitude) < 0.0001;
  const lngMatch = Math.abs(Number(receivedData.longitude) - DRIVER_LOCATION_PAYLOAD.longitude) < 0.0001;

  if (latMatch && lngMatch) {
    pass(`Tọa độ khớp chính xác với payload đã gửi ✓`);
  } else {
    fail(`Tọa độ KHÔNG khớp! Sent: (${DRIVER_LOCATION_PAYLOAD.latitude}, ${DRIVER_LOCATION_PAYLOAD.longitude}) Got: (${receivedData.latitude}, ${receivedData.longitude})`);
    cleanup(1);
    return;
  }

  cleanup(0);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
runTest().catch((err) => {
  fail(`Unhandled error: ${err.message}`);
  process.exit(1);
});
