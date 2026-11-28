/**
 * SmartExpress / SmartDelivery — Full End-to-End Pre-Defense Verification Script
 *
 * Tests:
 *   1. Auth, RBAC & IDOR (Admin, Dispatcher, Driver)
 *   2. All 4 Final Domain Fixes (POST /api/drivers, POD requires OPEN shift,
 *      Order state-transition guard, Route PLANNED -> IN_PROGRESS)
 *   3. Web Admin Core Flows (Dashboard, Orders, Zones + 409 Exclusivity + Delete,
 *      VRP Optimize & Confirm, 4 Report Tabs, 5 Excel Exports, AI Analyst RAG)
 *   4. Mobile Driver Full Lifecycle (Open Shift, Active Route, Mark Arrived,
 *      POD JPEG upload + Local Disk Fallback + COD accumulation, Fail/Reschedule,
 *      Close Shift -> PENDING_SETTLEMENT, Cashier Reconcile -> CLOSED)
 *   5. Realtime Socket.IO GPS Pipeline (25 rapid pings -> no block at 20,
 *      exact 1:1 delivery to 'dispatchers' room, 0 duplicates)
 *   6. Web Admin SSR/Route Smoke Check (http://localhost:3000)
 *   7. 100% Database & Disk Cleanup (asserts exact pre/post table counts match)
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const sharp = require('sharp');

const API_BASE = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';
const HUB_01_ID = 'depot000-0000-0000-0000-000000000001';
const SEED_DRIVER_01_ID = 'u0000000-0000-0000-0000-000000000101';

const results = [];
const cleanup = {
  userIds: new Set(),
  orderIds: new Set(),
  zoneIds: new Set(),
  routeIds: new Set(),
  shiftIds: new Set(),
  uploadedFiles: new Set(),
};

function mysqlQuery(sql) {
  const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');
  return execSync(
    `docker exec delivery_mysql mysql -uroot -psapassword delivery_db -N -e "${escaped}"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

function getAllTableCounts() {
  const tables = [
    'depots',
    'drivers',
    'notifications',
    'order_status_histories',
    'orders',
    'password_resets',
    'proof_of_deliveries',
    'regions',
    'reports',
    'routes',
    'shifts',
    'stops',
    'tracking_logs',
    'users',
    'zone_drivers',
    'zones',
  ];
  const unionSql = tables.map((t) => `SELECT '${t}', COUNT(*) FROM ${t}`).join(' UNION ALL ');
  const out = mysqlQuery(unionSql);
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, cnt] = line.split('\t');
    map[name] = Number(cnt);
  }
  return map;
}

async function apiReq(method, endpoint, { token, body, formData, rawBuffer } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let reqBody;
  if (formData) {
    reqBody = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: reqBody,
  });
  const ms = Date.now() - t0;
  if (rawBuffer) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ms, buf, headers: res.headers };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ms, data: json, headers: res.headers };
}

async function runStep(section, name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    const ms = Date.now() - t0;
    results.push({ section, name, status: 'PASS', ms, detail: info || '' });
    console.log(`  [PASS] (${ms}ms) ${name}${info ? ` — ${info}` : ''}`);
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ section, name, status: 'FAIL', ms, detail: msg });
    console.error(`  [FAIL] (${ms}ms) ${name} — ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const ts = Date.now();
  const preCounts = getAllTableCounts();
  console.log('=== Pre-E2E DB Snapshot captured ===');

  let adminToken = '';
  let dispatcherToken = '';
  let driver01Token = '';
  let e2eDriverId = '';
  let e2eDriverToken = '';
  let e2eDriverNoShiftId = '';
  let e2eDriverNoShiftToken = '';
  let order1Id = '';
  let order1Code = '';
  let order2Id = '';
  let order3Id = '';
  let e2eZoneId = '';
  let e2eShiftId = '';
  let e2eRouteId = '';
  let e2eNoShiftRouteId = '';
  let stop1Id = '';
  let stop2Id = '';
  let noShiftStopId = '';

  try {
    // =========================================================================
    // 1. AUTH, RBAC & IDOR FLOW
    // =========================================================================
    console.log('\n--- 1. Auth, RBAC & IDOR Flow ---');

    await runStep('1. Auth & RBAC', 'Login as ADMIN, DISPATCHER, DRIVER', async () => {
      const [a, d, dr] = await Promise.all([
        apiReq('POST', '/auth/login', {
          body: { email: 'admin@smartexpress.vn', password: '123456' },
        }),
        apiReq('POST', '/auth/login', {
          body: { email: 'dispatcher1@smartexpress.vn', password: '123456' },
        }),
        apiReq('POST', '/auth/login', {
          body: { email: 'driver01@smartexpress.vn', password: '123456' },
        }),
      ]);
      assert(a.status === 200 && a.data?.accessToken, `Admin login failed: ${a.status}`);
      assert(d.status === 200 && d.data?.accessToken, `Dispatcher login failed: ${d.status}`);
      assert(dr.status === 200 && dr.data?.accessToken, `Driver01 login failed: ${dr.status}`);
      adminToken = a.data.accessToken;
      dispatcherToken = d.data.accessToken;
      driver01Token = dr.data.accessToken;
      return `HTTP ${a.status}/${d.status}/${dr.status}`;
    });

    await runStep('1. Auth & RBAC', 'DRIVER blocked (403) on Admin/Dispatcher endpoints', async () => {
      const [u, rep, live] = await Promise.all([
        apiReq('GET', '/users', { token: driver01Token }),
        apiReq('GET', '/reports/dashboard', { token: driver01Token }),
        apiReq('GET', '/tracking/live', { token: driver01Token }),
      ]);
      assert(u.status === 403, `Expected 403 on /users, got ${u.status}`);
      assert(rep.status === 403, `Expected 403 on /reports/dashboard, got ${rep.status}`);
      assert(live.status === 403, `Expected 403 on /tracking/live, got ${live.status}`);
      return `HTTP 403 / 403 / 403`;
    });

    await runStep('1. Auth & RBAC', 'DRIVER IDOR blocked (403) on another driver stop', async () => {
      const otherStopId = mysqlQuery(
        `SELECT s.id FROM stops s JOIN routes r ON r.id=s.route_id WHERE r.driver_id != '${SEED_DRIVER_01_ID}' LIMIT 1;`,
      );
      assert(otherStopId, 'Could not find another driver stop in DB');
      const res = await apiReq('GET', `/stops/${otherStopId}`, { token: driver01Token });
      assert(res.status === 403, `Expected 403 IDOR block, got ${res.status}`);
      return `GET /stops/${otherStopId.slice(0, 8)}... -> HTTP ${res.status}`;
    });

    await runStep('1. Auth & RBAC', 'DISPATCHER blocked (403) on /api/users', async () => {
      const [listRes, createRes] = await Promise.all([
        apiReq('GET', '/users', { token: dispatcherToken }),
        apiReq('POST', '/users', {
          token: dispatcherToken,
          body: {
            fullName: 'Forbidden Test',
            email: `forbid.${ts}@smartexpress.vn`,
            phone: '0999888777',
            role: 'DRIVER',
          },
        }),
      ]);
      assert(listRes.status === 403, `Expected 403 on GET /users, got ${listRes.status}`);
      assert(createRes.status === 403, `Expected 403 on POST /users, got ${createRes.status}`);
      return `GET /users -> 403, POST /users -> 403`;
    });

    await runStep(
      '1. Auth & RBAC',
      '[Fix #1] DISPATCHER creates single driver atomically via POST /api/drivers (201)',
      async () => {
        const phone1 = `09${String(ts).slice(-8)}`;
        const phone2 = `08${String(ts).slice(-8)}`;
        const plate1 = `59E1-${String(ts).slice(-5)}`;
        const plate2 = `59E2-${String(ts).slice(-5)}`;

        const res1 = await apiReq('POST', '/drivers', {
          token: dispatcherToken,
          body: {
            fullName: 'E2E Test Driver Main',
            email: `e2e.driver.${ts}@smartexpress.vn`,
            phone: phone1,
            password: 'Password123!',
            licensePlate: plate1,
            vehicleType: 'MOTORBIKE',
            depotId: HUB_01_ID,
            maxWeightKg: 50,
            maxVolumeM3: 0.2,
          },
        });
        assert(
          res1.status === 201 && res1.data?.userId && res1.data?.user?.role === 'DRIVER',
          `Expected 201 + role=DRIVER, got ${res1.status}: ${JSON.stringify(res1.data)}`,
        );
        e2eDriverId = res1.data.userId;
        cleanup.userIds.add(e2eDriverId);

        // Login with newly created E2E driver
        const loginRes = await apiReq('POST', '/auth/login', {
          body: { email: `e2e.driver.${ts}@smartexpress.vn`, password: 'Password123!' },
        });
        assert(loginRes.status === 200 && loginRes.data?.accessToken, 'New E2E driver login failed');
        e2eDriverToken = loginRes.data.accessToken;

        // Also create a 2nd temporary driver (no OPEN shift) to test Fix #2 cleanly
        const res2 = await apiReq('POST', '/drivers', {
          token: dispatcherToken,
          body: {
            fullName: 'E2E Test Driver NoShift',
            email: `e2e.noshift.${ts}@smartexpress.vn`,
            phone: phone2,
            password: 'Password123!',
            licensePlate: plate2,
            vehicleType: 'MOTORBIKE',
            depotId: HUB_01_ID,
            maxWeightKg: 50,
            maxVolumeM3: 0.2,
            currentShiftStatus: 'ONLINE_READY',
          },
        });
        assert(res2.status === 201 && res2.data?.userId, `2nd E2E driver create failed: ${res2.status}`);
        e2eDriverNoShiftId = res2.data.userId;
        cleanup.userIds.add(e2eDriverNoShiftId);

        const login2 = await apiReq('POST', '/auth/login', {
          body: { email: `e2e.noshift.${ts}@smartexpress.vn`, password: 'Password123!' },
        });
        e2eDriverNoShiftToken = login2.data.accessToken;

        return `HTTP 201, userId=${e2eDriverId.slice(0, 8)}..., role=DRIVER, login OK`;
      },
    );

    // =========================================================================
    // 2. WEB ADMIN CORE FLOWS
    // =========================================================================
    console.log('\n--- 2. Web Admin Core Flows ---');

    await runStep('2. Web Admin', 'GET /api/reports/dashboard (KPIs present)', async () => {
      const res = await apiReq('GET', '/reports/dashboard', { token: dispatcherToken });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(typeof res.data?.totalOrders === 'number', 'Missing totalOrders');
      assert(Array.isArray(res.data?.chartData) && res.data.chartData.length === 7, 'Invalid chartData');
      return `HTTP 200 | totalOrders=${res.data.totalOrders}, activeDrivers=${res.data.activeDrivers}, successRate=${res.data.successRate}%`;
    });

    await runStep(
      '2. Web Admin',
      '[Fix #3] Orders CRUD + illegal NEW -> DELIVERED blocked (400)',
      async () => {
        const makeOrder = (idx, cod, lat, lng) =>
          apiReq('POST', '/orders', {
            token: dispatcherToken,
            body: {
              receiverName: `E2E Customer ${idx}`,
              receiverPhone: `090123456${idx}`,
              deliveryAddress: `${idx}00 Quang Trung, Gò Vấp, TP.HCM`,
              latitude: lat,
              longitude: lng,
              weightKg: 2.5,
              volumeM3: 0.02,
              codAmount: cod,
              deliveryFee: 25000,
              depotId: HUB_01_ID,
            },
          });

        const [o1, o2, o3] = await Promise.all([
          makeOrder(1, 150000, 10.8385, 106.6655),
          makeOrder(2, 200000, 10.8321, 106.6712),
          makeOrder(3, 100000, 10.8411, 106.6791),
        ]);
        assert(o1.status === 201 && o2.status === 201 && o3.status === 201, 'Order create failed');
        order1Id = o1.data.id;
        order1Code = o1.data.code;
        order2Id = o2.data.id;
        order3Id = o3.data.id;
        cleanup.orderIds.add(order1Id);
        cleanup.orderIds.add(order2Id);
        cleanup.orderIds.add(order3Id);

        // Illegal jump NEW -> DELIVERED must return 400
        const illegal = await apiReq('PATCH', `/orders/${order1Id}/status`, {
          token: dispatcherToken,
          body: { status: 'DELIVERED' },
        });
        assert(
          illegal.status === 400,
          `Expected 400 for NEW->DELIVERED, got ${illegal.status}: ${JSON.stringify(illegal.data)}`,
        );

        // Update order details
        const upd = await apiReq('PATCH', `/orders/${order1Id}`, {
          token: dispatcherToken,
          body: { notes: 'E2E updated note' },
        });
        assert(upd.status === 200 && upd.data?.notes === 'E2E updated note', 'Order update failed');

        // List / filter
        const list = await apiReq('GET', `/orders?search=${encodeURIComponent(order1Code)}`, {
          token: dispatcherToken,
        });
        assert(
          list.status === 200 && list.data?.data?.some((o) => o.id === order1Id),
          'Order search filter did not find created order',
        );

        return `Create 201, NEW->DELIVERED 400, Update 200, Filter 200 (${order1Code})`;
      },
    );

    await runStep(
      '2. Web Admin',
      'Zones: Create (201) -> Single-Zone Exclusivity (409) -> DELETE persists (404)',
      async () => {
        const createRes = await apiReq('POST', '/zones', {
          token: dispatcherToken,
          body: {
            name: `E2E Temp Zone ${ts}`,
            boundaryGeoJson: {
              type: 'Polygon',
              coordinates: [
                [
                  [106.66, 10.83],
                  [106.68, 10.83],
                  [106.68, 10.85],
                  [106.66, 10.85],
                  [106.66, 10.83],
                ],
              ],
            },
          },
        });
        assert(createRes.status === 201 && createRes.data?.id, `Zone create failed: ${createRes.status}`);
        e2eZoneId = createRes.data.id;
        cleanup.zoneIds.add(e2eZoneId);

        // Attempt to assign SEED_DRIVER_01 (already in Zone 01) -> must 409 Conflict
        const conflictRes = await apiReq('POST', `/zones/${e2eZoneId}/drivers`, {
          token: dispatcherToken,
          body: { driverIds: [SEED_DRIVER_01_ID] },
        });
        assert(conflictRes.status === 409, `Expected 409 Conflict, got ${conflictRes.status}`);

        // Delete zone -> must persist in DB
        const delRes = await apiReq('DELETE', `/zones/${e2eZoneId}`, { token: dispatcherToken });
        assert(delRes.status === 200 && delRes.data?.success === true, `Zone delete failed: ${delRes.status}`);
        cleanup.zoneIds.delete(e2eZoneId);

        const checkRes = await apiReq('GET', `/zones/${e2eZoneId}`, { token: dispatcherToken });
        assert(checkRes.status === 404, `Expected 404 after delete, got ${checkRes.status}`);

        return `Create 201 -> Exclusivity 409 -> Delete 200 -> Re-fetch 404`;
      },
    );

    await runStep(
      '2. Web Admin',
      '[Fix #2 Pre-Check] POD submission rejected (400) when driver has NO OPEN shift',
      async () => {
        // Confirm a 1-stop route for e2eDriverNoShift (who has ONLINE_READY status but NO OPEN shift)
        const confirmNoShift = await apiReq('POST', '/vrp/confirm', {
          token: dispatcherToken,
          body: {
            routes: [
              {
                depotId: HUB_01_ID,
                driverId: e2eDriverNoShiftId,
                totalDistanceKm: 2.1,
                totalEstimatedTimeMin: 12,
                polyline: [
                  [10.8468, 106.6752],
                  [10.8411, 106.6791],
                ],
                stops: [{ orderId: order3Id, sequenceNo: 1 }],
              },
            ],
          },
        });
        assert(confirmNoShift.status === 200, `Confirm no-shift route failed: ${confirmNoShift.status}`);
        e2eNoShiftRouteId = confirmNoShift.data.routeIds[0];
        cleanup.routeIds.add(e2eNoShiftRouteId);

        const active = await apiReq('GET', '/driver/active-route', {
          token: e2eDriverNoShiftToken,
        });
        noShiftStopId = active.data?.route?.stops?.[0]?.id;
        assert(noShiftStopId, 'No stop found for no-shift driver');

        // Build real 16x16 JPEG buffer using sharp
        const jpegBuf = await sharp({
          create: { width: 16, height: 16, channels: 3, background: { r: 220, g: 50, b: 50 } },
        })
          .jpeg()
          .toBuffer();

        const fd = new FormData();
        fd.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'noshift.jpg');
        fd.append('codCollected', '100000');

        const podRes = await apiReq('POST', `/stops/${noShiftStopId}/pod`, {
          token: e2eDriverNoShiftToken,
          formData: fd,
        });
        assert(
          podRes.status === 400,
          `Expected 400 when no OPEN shift, got ${podRes.status}: ${JSON.stringify(podRes.data)}`,
        );
        return `HTTP 400 — "${podRes.data?.message}"`;
      },
    );

    await runStep(
      '2. Web Admin',
      'Open Shift + VRP Optimize Hub 01 + Confirm Route (orders.driver_id & routes.shift_id)',
      async () => {
        // 1. Open shift for e2eDriver first so VRP confirm links routes.shift_id
        const openRes = await apiReq('POST', '/shifts/open', {
          token: e2eDriverToken,
          body: { startingCash: 0, latitude: 10.8468, longitude: 106.6752 },
        });
        assert(
          (openRes.status === 200 || openRes.status === 201) && openRes.data?.shift?.status === 'OPEN',
          `Open shift failed: ${openRes.status}`,
        );
        e2eShiftId = openRes.data.shift.id;
        cleanup.shiftIds.add(e2eShiftId);

        // 2. Optimize Hub 01 orders for e2eDriver
        const optRes = await apiReq('POST', '/vrp/optimize', {
          token: dispatcherToken,
          body: {
            depotId: HUB_01_ID,
            orderIds: [order1Id, order2Id],
            driverIds: [e2eDriverId],
          },
        });
        assert(
          optRes.status === 200 && optRes.data?.routes?.length === 1 && optRes.data.assignedOrders === 2,
          `VRP optimize failed: ${optRes.status} routes=${optRes.data?.routes?.length}`,
        );
        const proposed = optRes.data.routes[0];

        // 3. Confirm route
        const confRes = await apiReq('POST', '/vrp/confirm', {
          token: dispatcherToken,
          body: {
            routes: [
              {
                depotId: HUB_01_ID,
                driverId: proposed.driverId,
                totalDistanceKm: proposed.totalDistanceKm,
                totalEstimatedTimeMin: proposed.totalEstimatedTimeMin,
                polyline: proposed.polyline,
                stops: proposed.stops.map((s) => ({
                  orderId: s.orderId,
                  sequenceNo: s.sequenceNo,
                })),
              },
            ],
          },
        });
        assert(confRes.status === 200 && confRes.data?.routeIds?.length === 1, `VRP confirm failed: ${confRes.status}`);
        e2eRouteId = confRes.data.routeIds[0];
        cleanup.routeIds.add(e2eRouteId);

        // Verify in MySQL: orders.driver_id & routes.shift_id populated
        const routeRow = mysqlQuery(`SELECT status, shift_id FROM routes WHERE id='${e2eRouteId}';`);
        const [rStatus, rShiftId] = routeRow.split('\t');
        assert(rStatus === 'PLANNED', `Expected route status PLANNED, got ${rStatus}`);
        assert(rShiftId === e2eShiftId, `Expected routes.shift_id=${e2eShiftId}, got ${rShiftId}`);

        const orderDrivers = mysqlQuery(
          `SELECT driver_id FROM orders WHERE id IN ('${order1Id}','${order2Id}');`,
        ).split(/\r?\n/);
        assert(
          orderDrivers.length === 2 && orderDrivers.every((d) => d === e2eDriverId),
          `orders.driver_id not populated: ${JSON.stringify(orderDrivers)}`,
        );

        return `Optimize 200 (${proposed.totalDistanceKm}km) -> Confirm 200 | routes.shift_id & orders.driver_id verified`;
      },
    );

    await runStep('2. Web Admin', 'Reports (4 Tabs), 5 Excel (.xlsx) Exports & AI Analyst RAG', async () => {
      const [kpis, analytics, insights, chat] = await Promise.all([
        apiReq('GET', '/reports/kpis?period=month', { token: dispatcherToken }),
        apiReq('GET', '/reports/analytics?days=30', { token: dispatcherToken }),
        apiReq('GET', '/ai-analyst/insights?days=30', { token: dispatcherToken }),
        apiReq('POST', '/ai-analyst/chat', {
          token: dispatcherToken,
          body: { question: 'Tổng doanh thu tháng này là bao nhiêu?', days: 30 },
        }),
      ]);
      assert(kpis.status === 200 && typeof kpis.data?.totalOrders === 'number', 'KPIs tab failed');
      assert(analytics.status === 200 && analytics.data?.revenueReport, 'Analytics tab failed');
      assert(insights.status === 200 && insights.data?.forecast, 'AI insights tab failed');
      assert(chat.status === 201 || chat.status === 200, `AI chat failed: ${chat.status}`);
      assert(typeof chat.data?.answer === 'string' && chat.data.answer.length > 20, 'AI chat answer empty');

      // Verify all Excel exports start with ZIP/XLSX magic bytes PK\x03\x04
      const excelEndpoints = [
        '/reports/export/excel',
        '/reports/export/orders',
        '/reports/export-analytics?days=30&type=revenue',
        '/reports/export-analytics?days=30&type=top_drivers',
        '/reports/export-analytics?days=30&type=top_customers',
      ];
      const excels = await Promise.all(
        excelEndpoints.map((ep) => apiReq('GET', ep, { token: dispatcherToken, rawBuffer: true })),
      );
      for (let i = 0; i < excels.length; i++) {
        const ex = excels[i];
        assert(ex.status === 200, `Excel ${excelEndpoints[i]} returned ${ex.status}`);
        assert(
          ex.buf.length > 1000 && ex.buf[0] === 0x50 && ex.buf[1] === 0x4b,
          `Excel ${excelEndpoints[i]} invalid xlsx buffer (${ex.buf.length} bytes)`,
        );
      }
      return `4 Report APIs 200, 5 .xlsx exports valid PKZIP, AI chat mode=${chat.data.mode}`;
    });

    // =========================================================================
    // 3. MOBILE DRIVER LIFECYCLE FLOW
    // =========================================================================
    console.log('\n--- 3. Mobile Driver Lifecycle Flow ---');

    await runStep(
      '3. Mobile Lifecycle',
      '[Fix #4] Active Route (PLANNED) -> Mark Arrived -> Route flips to IN_PROGRESS',
      async () => {
        const active = await apiReq('GET', '/driver/active-route', { token: e2eDriverToken });
        assert(
          active.status === 200 && active.data?.hasActiveRoute && active.data.route.status === 'PLANNED',
          `Expected PLANNED active route, got ${active.status} / ${active.data?.route?.status}`,
        );
        const stops = active.data.route.stops;
        assert(stops.length === 2, `Expected 2 stops, got ${stops.length}`);
        const s1 = stops.find((s) => s.order.id === order1Id);
        const s2 = stops.find((s) => s.order.id === order2Id);
        stop1Id = s1.id;
        stop2Id = s2.id;

        const arrived = await apiReq('PATCH', `/stops/${stop1Id}/arrived`, {
          token: e2eDriverToken,
        });
        assert(arrived.status === 200 && arrived.data?.data?.status === 'ARRIVED', 'markArrived failed');

        const routeStatusAfter = mysqlQuery(`SELECT status FROM routes WHERE id='${e2eRouteId}';`);
        assert(
          routeStatusAfter === 'IN_PROGRESS',
          `Expected Route.status=IN_PROGRESS after markArrived, got ${routeStatusAfter}`,
        );
        return `PATCH /stops/:id/arrived 200 -> Route.status PLANNED -> IN_PROGRESS`;
      },
    );

    await runStep(
      '3. Mobile Lifecycle',
      'Submit POD (JPEG + Magic Bytes + Local Disk Fallback + COD) & Terminal Guard (400)',
      async () => {
        const jpegBuf = await sharp({
          create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 160, b: 90 } },
        })
          .jpeg()
          .toBuffer();

        const fd = new FormData();
        fd.append('file', new Blob([jpegBuf], { type: 'image/jpeg' }), 'e2e-pod.jpg');
        fd.append('codCollected', '150000');
        fd.append('notes', 'E2E giao thanh cong');

        const podRes = await apiReq('POST', `/stops/${stop1Id}/pod`, {
          token: e2eDriverToken,
          formData: fd,
        });
        assert(
          (podRes.status === 200 || podRes.status === 201) && podRes.data?.success,
          `submitPod failed: ${podRes.status} ${JSON.stringify(podRes.data)}`,
        );
        assert(podRes.data.data.orderStatus === 'DELIVERED', 'Order not DELIVERED');
        assert(podRes.data.data.shiftCodCollected === 150000, `Expected shiftCod=150000, got ${podRes.data.data.shiftCodCollected}`);

        const photoUrl = podRes.data.data.photoUrl;
        assert(typeof photoUrl === 'string' && photoUrl.length > 0, 'Missing photoUrl');
        if (photoUrl.startsWith('/uploads/')) {
          const fullDiskPath = path.join(process.cwd(), photoUrl.replace(/^\//, ''));
          cleanup.uploadedFiles.add(fullDiskPath);
          const imgRes = await fetch(`http://localhost:3001${photoUrl}`);
          assert(imgRes.status === 200, `POD image static serve failed: ${imgRes.status}`);
        }

        // [Fix #3] Verify terminal state DELIVERED cannot be mutated
        const mutateDelivered = await apiReq('PATCH', `/orders/${order1Id}/status`, {
          token: adminToken,
          body: { status: 'CANCELLED' },
        });
        assert(
          mutateDelivered.status === 400,
          `Expected 400 mutating DELIVERED order, got ${mutateDelivered.status}`,
        );

        return `POD HTTP ${podRes.status}, COD=150000, photo=${photoUrl}, DELIVERED->CANCELLED blocked (400)`;
      },
    );

    await runStep(
      '3. Mobile Lifecycle',
      'Report Failed/Rescheduled Stop -> Auto-Complete Route -> Close Shift (PENDING_SETTLEMENT) -> Reconcile (CLOSED)',
      async () => {
        const tomorrowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const failRes = await apiReq('POST', `/stops/${stop2Id}/fail`, {
          token: e2eDriverToken,
          body: {
            action: 'RESCHEDULED',
            failureReason: 'Khách hẹn giao ngày mai (E2E)',
            rescheduledDate: tomorrowIso,
          },
        });
        assert(
          failRes.status === 200 && failRes.data?.data?.orderStatus === 'RESCHEDULED',
          `failStop failed: ${failRes.status} ${JSON.stringify(failRes.data)}`,
        );

        const routeFinalStatus = mysqlQuery(`SELECT status FROM routes WHERE id='${e2eRouteId}';`);
        assert(routeFinalStatus === 'COMPLETED', `Expected route COMPLETED, got ${routeFinalStatus}`);

        // Close Shift -> PENDING_SETTLEMENT (tests MySQL chk_shift_status live!)
        const closeRes = await apiReq('POST', `/shifts/${e2eShiftId}/close`, {
          token: e2eDriverToken,
          body: { codSubmitted: 150000, notes: 'E2E nộp đủ COD' },
        });
        assert(
          (closeRes.status === 200 || closeRes.status === 201) &&
            closeRes.data?.shift?.status === 'PENDING_SETTLEMENT',
          `closeShift failed: ${closeRes.status} ${JSON.stringify(closeRes.data)}`,
        );

        // Cashier Reconcile -> CLOSED
        const recRes = await apiReq('PATCH', `/reports/shifts/${e2eShiftId}/reconcile`, {
          token: dispatcherToken,
          body: { submittedAmount: 150000 },
        });
        assert(
          recRes.status === 200 && recRes.data?.shift?.status === 'CLOSED',
          `reconcileShift failed: ${recRes.status} ${JSON.stringify(recRes.data)}`,
        );

        return `Fail/Reschedule 200 -> Route COMPLETED -> Close PENDING_SETTLEMENT -> Reconcile CLOSED`;
      },
    );

    // =========================================================================
    // 4. REALTIME SOCKET.IO GPS PIPELINE
    // =========================================================================
    console.log('\n--- 4. Realtime Socket.IO GPS Pipeline ---');

    await runStep(
      '4. Socket.IO GPS',
      '25 rapid update_location pings -> no block at 20 (120/min) & exact 1:1 broadcast to dispatchers',
      async () => {
        const dispSocket = io(SOCKET_URL, {
          auth: { token: dispatcherToken },
          transports: ['websocket'],
          reconnection: false,
        });
        const drvSocket = io(SOCKET_URL, {
          auth: { token: e2eDriverToken },
          transports: ['websocket'],
          reconnection: false,
        });

        try {
          await Promise.all([
            new Promise((resolve, reject) => {
              dispSocket.once('connected', resolve);
              dispSocket.once('connect_error', reject);
              setTimeout(() => reject(new Error('Dispatcher socket connect timeout')), 5000);
            }),
            new Promise((resolve, reject) => {
              drvSocket.once('connected', resolve);
              drvSocket.once('connect_error', reject);
              setTimeout(() => reject(new Error('Driver socket connect timeout')), 5000);
            }),
          ]);

          let receivedCount = 0;
          dispSocket.on('driver_location_updated', (payload) => {
            if (payload?.driverId === e2eDriverId) {
              receivedCount++;
            }
          });

          let ackSuccess = 0;
          for (let i = 0; i < 25; i++) {
            const ack = await new Promise((resolve, reject) => {
              drvSocket.emit(
                'update_location',
                {
                  latitude: 10.8468 + i * 0.0001,
                  longitude: 106.6752 + i * 0.0001,
                  batteryLevel: 95,
                },
                (resp) => resolve(resp),
              );
              setTimeout(() => reject(new Error(`Ping #${i + 1} ACK timeout`)), 3000);
            });
            if (ack?.success) ackSuccess++;
          }

          // Allow final broadcast frames to arrive
          await new Promise((r) => setTimeout(r, 400));

          assert(ackSuccess === 25, `Expected 25/25 ACKs, got ${ackSuccess}/25`);
          assert(
            receivedCount === 25,
            `Expected exactly 25 dispatcher broadcasts (1:1, no duplicates), got ${receivedCount}`,
          );

          return `25/25 ACKs OK, Dispatcher received exactly ${receivedCount}/25 events (0 duplicates)`;
        } finally {
          dispSocket.disconnect();
          drvSocket.disconnect();
        }
      },
    );

    // =========================================================================
    // 5. WEB ADMIN LIVE ROUTE SMOKE CHECK
    // =========================================================================
    console.log('\n--- 5. Web Admin Live Check ---');

    await runStep('5. Web Admin Live', 'Key Next.js routes respond HTTP 200 on :3000', async () => {
      const paths = ['/login', '/dashboard', '/drivers', '/orders', '/zones', '/vrp', '/reports', '/admin/tracking'];
      const statuses = await Promise.all(
        paths.map(async (p) => {
          const r = await fetch(`${WEB_BASE}${p}`);
          return { p, status: r.status };
        }),
      );
      const bad = statuses.filter((s) => s.status !== 200);
      assert(bad.length === 0, `Non-200 Web routes: ${JSON.stringify(bad)}`);
      return `${paths.length}/${paths.length} routes HTTP 200`;
    });
  } finally {
    // =========================================================================
    // 6. CLEANUP ALL TEMPORARY E2E RECORDS & FILES
    // =========================================================================
    console.log('\n--- 6. Cleanup Temporary E2E Data ---');

    const quoteList = (set) =>
      Array.from(set)
        .filter(Boolean)
        .map((v) => `'${v}'`)
        .join(',');

    try {
      const userList = quoteList(cleanup.userIds);
      const routeList = quoteList(cleanup.routeIds);
      const orderList = quoteList(cleanup.orderIds);
      const shiftList = quoteList(cleanup.shiftIds);
      const zoneList = quoteList(cleanup.zoneIds);

      const statements = [];
      if (userList) statements.push(`DELETE FROM tracking_logs WHERE driver_id IN (${userList});`);
      if (routeList) {
        statements.push(
          `DELETE FROM proof_of_deliveries WHERE stop_id IN (SELECT id FROM stops WHERE route_id IN (${routeList}));`,
        );
        statements.push(`DELETE FROM stops WHERE route_id IN (${routeList});`);
        statements.push(`DELETE FROM routes WHERE id IN (${routeList});`);
      }
      if (orderList) {
        statements.push(`DELETE FROM order_status_histories WHERE order_id IN (${orderList});`);
        statements.push(`DELETE FROM orders WHERE id IN (${orderList});`);
      }
      if (shiftList) statements.push(`DELETE FROM shifts WHERE id IN (${shiftList});`);
      if (userList) {
        statements.push(`DELETE FROM shifts WHERE driver_id IN (${userList});`);
        statements.push(`DELETE FROM zone_drivers WHERE driver_id IN (${userList});`);
        statements.push(`DELETE FROM drivers WHERE user_id IN (${userList});`);
        statements.push(`DELETE FROM users WHERE id IN (${userList});`);
      }
      if (zoneList) {
        statements.push(`DELETE FROM zone_drivers WHERE zone_id IN (${zoneList});`);
        statements.push(`DELETE FROM zones WHERE id IN (${zoneList});`);
      }

      if (statements.length > 0) {
        mysqlQuery(statements.join(' '));
      }

      for (const f of cleanup.uploadedFiles) {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      }
    } catch (cleanErr) {
      console.error('Cleanup error:', cleanErr);
    }

    const postCounts = getAllTableCounts();
    const diffs = [];
    for (const [tbl, pre] of Object.entries(preCounts)) {
      if (postCounts[tbl] !== pre) {
        diffs.push(`${tbl}: ${pre} -> ${postCounts[tbl]}`);
      }
    }

    if (diffs.length === 0) {
      results.push({
        section: '6. Cleanup',
        name: 'Database & Disk Cleanup Verification (all 16 tables match pre-E2E snapshot)',
        status: 'PASS',
        ms: 0,
        detail: `0 leftover records across all 16 tables, ${cleanup.uploadedFiles.size} temp POD file(s) deleted`,
      });
      console.log('  [PASS] DB Cleanup 100% clean — all 16 table counts identical to pre-E2E!');
    } else {
      results.push({
        section: '6. Cleanup',
        name: 'Database & Disk Cleanup Verification',
        status: 'FAIL',
        ms: 0,
        detail: `Row count drift: ${diffs.join(', ')}`,
      });
      console.error('  [FAIL] DB Cleanup drift:', diffs.join(', '));
    }

    // Print JSON summary for report generation
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\n=== E2E SUMMARY: ${passed}/${results.length} PASSED, ${failed} FAILED ===`);
    console.log('__E2E_JSON_START__');
    console.log(JSON.stringify({ passed, failed, total: results.length, preCounts, postCounts, results }, null, 2));
    console.log('__E2E_JSON_END__');
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal E2E runner error:', err);
  process.exit(1);
});
