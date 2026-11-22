/**
 * scripts/seed-reconciliation-demo.js
 *
 * Populates realistic data for Reports & COD Reconciliation (KLTN-131 Demo)
 * Covers:
 * 1. 50+ Orders created across the current week (T2 -> CN, Nov 16 - Nov 22, 2026)
 * 2. 6 Driver Shifts (4 PENDING reconciliation, 2 RECONCILED)
 * 3. 6 Routes linked to shifts via shift_id
 * 4. 25+ Route Stops linked to Orders
 * 5. Proof of Delivery (POD) records with photos and failure reasons
 */

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 3308,
  user: 'root',
  password: 'sapassword',
  database: 'delivery_db',
  charset: 'utf8mb4_unicode_ci',
};

// High quality placeholder delivery POD photo URLs
const POD_PHOTOS = [
  'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1616401784845-180882ba9ba8?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=600&auto=format&fit=crop',
];

function toSqlDateTime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function run() {
  console.log('Connecting to database...');
  const conn = await mysql.createConnection(DB_CONFIG);

  try {
    const now = new Date();
    console.log(`Current base date: ${now.toISOString()}`);

    // Fetch existing drivers & depots
    const [drivers] = await conn.query('SELECT user_id, license_plate, depot_id FROM drivers LIMIT 10');
    const [depots] = await conn.query('SELECT id FROM depots LIMIT 5');
    const [zones] = await conn.query('SELECT id FROM zones LIMIT 5');

    const depotId = depots[0]?.id || 'depot000-0000-0000-0000-000000000001';
    const zoneId = zones[0]?.id || 'zone0000-0000-0000-0000-000000000001';
    const adminId = 'u0000000-0000-0000-0000-000000000001';

    console.log(`Found ${drivers.length} drivers.`);

    // Clean up any previous demo data
    console.log('Cleaning up old demo data...');
    await conn.query(`DELETE FROM proof_of_deliveries WHERE id LIKE 'pod-demo-%'`);
    await conn.query(`DELETE FROM stops WHERE id LIKE 'stp-demo-%'`);
    await conn.query(`DELETE FROM routes WHERE id LIKE 'rot-demo-%'`);
    await conn.query(`DELETE FROM shifts WHERE id LIKE 'shf-demo-%'`);
    await conn.query(`DELETE FROM orders WHERE code LIKE 'ORD-2026-%'`);

    // ── 1. Create orders across past 7 days for weekly trends chart ──────────────
    console.log('--- 1. Seeding orders for the past 7 days ---');
    const createdOrders = [];
    const customers = [
      { name: 'Nguyễn Văn An', phone: '0912345671', addr: '12 Nguyễn Văn Bảo, P.4, Q. Gò Vấp' },
      { name: 'Trần Thị Mai', phone: '0912345672', addr: '45 Lê Đức Thọ, P.7, Q. Gò Vấp' },
      { name: 'Lê Hoàng Long', phone: '0912345673', addr: '78 Quang Trung, P.10, Q. Gò Vấp' },
      { name: 'Phạm Thanh Thảo', phone: '0912345674', addr: '102 Phan Văn Trị, P.5, Q. Gò Vấp' },
      { name: 'Hoàng Minh Tuấn', phone: '0912345675', addr: '23 Nguyễn Oanh, P.17, Q. Gò Vấp' },
      { name: 'Đỗ Bích Ngọc', phone: '0912345676', addr: '56 Phan Đăng Lưu, P.1, Q. Bình Thạnh' },
      { name: 'Vũ Đức Thịnh', phone: '0912345677', addr: '89 Bạch Đằng, P.24, Q. Bình Thạnh' },
      { name: 'Bùi Lan Anh', phone: '0912345678', addr: '15 Điện Biên Phủ, P.15, Q. Bình Thạnh' },
      { name: 'Trịnh Gia Huy', phone: '0912345679', addr: '34 Xô Viết Nghệ Tĩnh, P.21, Q. Bình Thạnh' },
      { name: 'Đinh Phương Linh', phone: '0912345680', addr: '67 Nơ Trang Long, P.13, Q. Bình Thạnh' },
    ];

    // Seed 40+ orders spread across last 7 days
    let orderIndex = 100;
    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
      const orderDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      const ordersPerDay = 5 + (dayOffset % 4); // 5 to 8 orders each day

      for (let o = 0; o < ordersPerDay; o++) {
        orderIndex++;
        const cust = customers[(o + dayOffset) % customers.length];
        const orderId = uuidv4();
        const code = `ORD-2026-${orderIndex}`;
        const hour = 8 + (o * 2) % 10;
        orderDate.setHours(hour, (o * 17) % 60, 0);

        const cod = [250000, 380000, 520000, 680000, 890000, 1150000, 450000][(o + dayOffset) % 7];
        const isFailed = (o === 3 && dayOffset % 2 === 0);
        const status = isFailed ? 'FAILED' : 'DELIVERED';

        await conn.query(
          `INSERT INTO orders (
            id, code, dispatcher_id, zone_id, depot_id,
            receiver_name, receiver_phone, delivery_address,
            latitude, longitude, weight_kg, volume_m3, cod_amount,
            status, created_at, updated_at, sender_name, sender_phone, delivery_fee
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE status=VALUES(status)`,
          [
            orderId, code, adminId, zoneId, depotId,
            cust.name, cust.phone, cust.addr,
            10.822 + (o * 0.005), 106.687 + (o * 0.004),
            1.5 + (o * 0.5), 0.01 + (o * 0.005), cod,
            status, toSqlDateTime(orderDate), toSqlDateTime(orderDate),
            'Kho Tổng SmartExpress', '19001234', 22000
          ]
        );

        createdOrders.push({
          id: orderId,
          code,
          codAmount: cod,
          status,
          receiverName: cust.name,
          receiverPhone: cust.phone,
          deliveryAddress: cust.addr,
          date: new Date(orderDate),
        });
      }
    }
    console.log(`✓ Seeded ${createdOrders.length} orders across past 7 days.`);

    // ── 2. Create Realistic Shifts with Routes & Stops ──────────────────────────
    console.log('--- 2. Seeding Shifts with Stops & PODs ---');

    // Remove old test demo shifts if any
    await conn.query(`DELETE FROM proof_of_deliveries WHERE id LIKE 'pod-demo-%'`);
    await conn.query(`DELETE FROM stops WHERE id LIKE 'stp-demo-%'`);
    await conn.query(`DELETE FROM routes WHERE id LIKE 'rot-demo-%'`);
    await conn.query(`DELETE FROM shifts WHERE id LIKE 'shf-demo-%'`);

    const shiftConfigs = [
      {
        id: 'shf-demo-001',
        driverId: drivers[0]?.user_id || 'u0000000-0000-0000-0000-000000000101',
        startTime: new Date(now.getTime() - 8 * 3600 * 1000), // 8 hours ago
        endTime: new Date(now.getTime() - 1 * 3600 * 1000),   // 1 hour ago
        status: 'PENDING_SETTLEMENT',
        reconciledAt: null,
        reconciledBy: null,
        codCollected: 2450000,
        codSubmitted: 2450000, // Khớp 100%
        startingCash: 500000,
        stopCount: 5,
        failedIndex: -1,
      },
      {
        id: 'shf-demo-002',
        driverId: drivers[1]?.user_id || 'u0000000-0000-0000-0000-000000000102',
        startTime: new Date(now.getTime() - 7 * 3600 * 1000),
        endTime: new Date(now.getTime() - 30 * 60 * 1000),
        status: 'PENDING_SETTLEMENT',
        reconciledAt: null,
        reconciledBy: null,
        codCollected: 3120000,
        codSubmitted: 3000000, // Thiếu 120.000 đ
        startingCash: 500000,
        stopCount: 5,
        failedIndex: 2,
      },
      {
        id: 'shf-demo-003',
        driverId: drivers[2]?.user_id || 'u0000000-0000-0000-0000-000000000103',
        startTime: new Date(now.getTime() - 28 * 3600 * 1000), // Hôm qua
        endTime: new Date(now.getTime() - 20 * 3600 * 1000),
        status: 'PENDING_SETTLEMENT',
        reconciledAt: null,
        reconciledBy: null,
        codCollected: 1850000,
        codSubmitted: 1850000, // Khớp 100%
        startingCash: 500000,
        stopCount: 4,
        failedIndex: -1,
      },
      {
        id: 'shf-demo-004',
        driverId: drivers[3]?.user_id || 'u0000000-0000-0000-0000-000000000104',
        startTime: new Date(now.getTime() - 26 * 3600 * 1000), // Hôm qua
        endTime: new Date(now.getTime() - 19 * 3600 * 1000),
        status: 'PENDING_SETTLEMENT',
        reconciledAt: null,
        reconciledBy: null,
        codCollected: 4200000,
        codSubmitted: 0, // Chưa nộp
        startingCash: 500000,
        stopCount: 6,
        failedIndex: 4,
      },
      {
        id: 'shf-demo-005',
        driverId: drivers[4]?.user_id || 'u0000000-0000-0000-0000-000000000105',
        startTime: new Date(now.getTime() - 52 * 3600 * 1000), // 2 ngày trước
        endTime: new Date(now.getTime() - 44 * 3600 * 1000),
        status: 'CLOSED',
        reconciledAt: new Date(now.getTime() - 43 * 3600 * 1000),
        reconciledBy: 'u0000000-0000-0000-0000-000000000001',
        codCollected: 2900000,
        codSubmitted: 2900000,
        startingCash: 500000,
        stopCount: 5,
        failedIndex: -1,
      },
      {
        id: 'shf-demo-006',
        driverId: drivers[5]?.user_id || 'u0000000-0000-0000-0000-000000000106',
        startTime: new Date(now.getTime() - 74 * 3600 * 1000), // 3 ngày trước
        endTime: new Date(now.getTime() - 66 * 3600 * 1000),
        status: 'CLOSED',
        reconciledAt: new Date(now.getTime() - 65 * 3600 * 1000),
        reconciledBy: 'u0000000-0000-0000-0000-000000000001',
        codCollected: 3450000,
        codSubmitted: 3450000,
        startingCash: 500000,
        stopCount: 5,
        failedIndex: -1,
      },
    ];

    let orderPointer = 0;
    let globalStopIndex = 1;
    let globalPodIndex = 1;

    for (let i = 0; i < shiftConfigs.length; i++) {
      const cfg = shiftConfigs[i];

      // 2.1 Insert Shift
      await conn.query(
        `INSERT INTO shifts (
          id, driver_id, start_time, end_time, status,
          starting_cash_cod, cod_collected, cod_submitted,
          reconciled_by, reconciled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cfg.id, cfg.driverId,
          toSqlDateTime(cfg.startTime),
          toSqlDateTime(cfg.endTime),
          cfg.status,
          cfg.startingCash,
          cfg.codCollected,
          cfg.codSubmitted,
          cfg.reconciledBy,
          cfg.reconciledAt ? toSqlDateTime(cfg.reconciledAt) : null,
        ]
      );

      // 2.2 Insert Route connected via shift_id
      const routeId = `rot-demo-${(i + 1).toString().padStart(3, '0')}`;
      const routeDist = 18.5 + i * 2.3;
      const routeTime = 120 + i * 15;

      await conn.query(
        `INSERT INTO routes (
          id, depot_id, driver_id, shift_id, dispatcher_id,
          route_date, total_distance_km, total_estimated_time_min,
          status, polyline, start_time, end_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          routeId, depotId, cfg.driverId, cfg.id, adminId,
          cfg.startTime.toISOString().slice(0, 10),
          routeDist, routeTime,
          'COMPLETED',
          'gcn_Cw_fiS|@fBf@d@oBhCe@t@e@x@oAhBm@r@s@z@y@x@w@|@s`k_Cm|eiSz@wBh@cCp@uDb@kF|A{Ix@eDt@qCp@kC',
          toSqlDateTime(cfg.startTime),
          toSqlDateTime(cfg.endTime),
          toSqlDateTime(cfg.startTime),
          toSqlDateTime(cfg.endTime),
        ]
      );

      // 2.3 Insert Stops & PODs for this route
      for (let s = 0; s < cfg.stopCount; s++) {
        const order = createdOrders[orderPointer % createdOrders.length];
        orderPointer++;

        const stopId = `stp-demo-${(globalStopIndex++).toString().padStart(4, '0')}`;
        const isFailed = (s === cfg.failedIndex);
        const stopStatus = isFailed ? 'FAILED' : 'COMPLETED';
        const arriveTime = new Date(cfg.startTime.getTime() + (s + 1) * 35 * 60 * 1000);

        await conn.query(
          `INSERT INTO stops (id, route_id, order_id, sequence_no, arrived_at, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            stopId, routeId, order.id, s + 1,
            toSqlDateTime(arriveTime),
            stopStatus,
          ]
        );

        // 2.4 Insert Proof of Delivery
        const podId = `pod-demo-${(globalPodIndex++).toString().padStart(4, '0')}`;
        const photo = POD_PHOTOS[s % POD_PHOTOS.length];

        if (isFailed) {
          await conn.query(
            `INSERT INTO proof_of_deliveries (
              id, stop_id, photo_url, cod_collected, failure_reason, confirmed_at
            ) VALUES (?, ?, NULL, 0.00, ?, ?)`,
            [
              podId, stopId,
              'Khách hẹn giao lại buổi tối sau 19h (không có nhà)',
              toSqlDateTime(arriveTime),
            ]
          );
        } else {
          await conn.query(
            `INSERT INTO proof_of_deliveries (
              id, stop_id, photo_url, cod_collected, failure_reason, confirmed_at
            ) VALUES (?, ?, ?, ?, NULL, ?)`,
            [
              podId, stopId, photo,
              order.codAmount,
              toSqlDateTime(arriveTime),
            ]
          );
        }
      }

      console.log(`✓ Seeded Shift ${cfg.id}: ${cfg.status} | COD: ${cfg.codCollected.toLocaleString('vi-VN')} đ | Stops: ${cfg.stopCount}`);
    }

    console.log('\n🎉 ALL DEMO DATA SEEDED SUCCESSFULLY!');
    console.log('- 4 Pending Shifts ready for single & bulk reconciliation');
    console.log('- 2 Reconciled Shifts for historical view');
    console.log('- 40+ Orders for weekly metrics & KPIs');
  } catch (err) {
    console.error('Error seeding demo data:', err);
  } finally {
    await conn.end();
  }
}

run();
