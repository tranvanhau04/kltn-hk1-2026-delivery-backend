/**
 * scripts/simulate-driver-gps.js
 *
 * Configurable GPS Simulator for Drivers in SmartExpress.
 * Simulates real-time telemetry over WebSocket Gateway (http://localhost:3001).
 *
 * Supported Modes:
 *   1. Mode "SINGLE" (Default):
 *      Simulates a single driver.
 *      - By environment variable:
 *        DRIVER_NAME="Vũ Quốc Bảo" npm run simulate:driver
 *        $env:DRIVER_NAME="Vũ Quốc Bảo"; npm run simulate:driver (PowerShell)
 *      - By CLI argument:
 *        npm run simulate:driver -- "Vũ Quốc Bảo"
 *        node scripts/simulate-driver-gps.js "Trương Gia Huy"
 *      - Default if omitted: "Văn Hậu Trần"
 *
 *   2. Mode "ALL":
 *      Simulates ALL active drivers concurrently with realistic lane offsets
 *      and staggered positions along the route in Ho Chi Minh City.
 *      - By environment variable:
 *        SIMULATE_MODE=ALL npm run simulate:driver
 *        $env:SIMULATE_MODE="ALL"; npm run simulate:driver (PowerShell)
 *      - By CLI argument / flag:
 *        npm run simulate:all
 *        npm run simulate:driver -- --all
 *        node scripts/simulate-driver-gps.js all
 *
 *   3. Helper --list:
 *      node scripts/simulate-driver-gps.js --list
 */

'use strict';

const path = require('path');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

// ── Colors for CLI output ─────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ── Configuration ─────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'kltn_hk1_2026_delivery_jwt_secret_key_change_in_production';

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3308,
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'sapassword',
  database: process.env.DB_DATABASE || 'delivery_db',
};

// Rate limiter safe interval: 3100ms (~19.3 requests / minute per socket < limit 20)
const INTERVAL_MS = 3100;

// ── Parse CLI Arguments & Env ─────────────────────────────────────────────────
function parseConfig() {
  const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
  const envMode = (process.env.SIMULATE_MODE || '').toUpperCase();

  if (rawArgs.includes('--list') || rawArgs.includes('-l')) {
    return { mode: 'LIST' };
  }

  // Check if mode is ALL
  const isAllFlag =
    rawArgs.includes('--all') ||
    rawArgs.includes('-a') ||
    rawArgs.some((a) => a.toLowerCase() === 'all') ||
    envMode === 'ALL';

  if (isAllFlag) {
    return { mode: 'ALL' };
  }

  // Single driver search query
  let query = '';

  for (const arg of rawArgs) {
    if (arg.startsWith('--name=')) query = arg.replace('--name=', '').trim();
    if (arg.startsWith('--driver=')) query = arg.replace('--driver=', '').trim();
    if (arg.startsWith('--id=')) query = arg.replace('--id=', '').trim();
  }

  if (!query) {
    const nameIndex = rawArgs.findIndex((a) => a === '--name' || a === '-n' || a === '--driver');
    if (nameIndex >= 0 && rawArgs[nameIndex + 1]) {
      query = rawArgs[nameIndex + 1].trim();
    }
  }

  if (!query) {
    const positional = rawArgs.find((a) => !a.startsWith('-'));
    if (positional) query = positional.trim();
  }

  if (!query) {
    if (process.env.DRIVER_NAME) query = process.env.DRIVER_NAME.trim();
    else if (process.env.DRIVER_ID) query = process.env.DRIVER_ID.trim();
  }

  // Default single driver
  if (!query) {
    query = 'Văn Hậu Trần';
  }

  return { mode: 'SINGLE', query };
}

// ── Database Driver Fetcher ───────────────────────────────────────────────────
async function fetchDriversFromDb(config) {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);

    // List all
    if (config.mode === 'LIST') {
      const [allDrivers] = await connection.query(`
        SELECT u.id, u.full_name, u.email, u.phone, d.license_plate, d.vehicle_type, d.current_shift_status
        FROM users u
        INNER JOIN drivers d ON u.id = d.user_id
        WHERE u.role = 'DRIVER'
        ORDER BY u.full_name ASC
      `);
      return { list: allDrivers };
    }

    // Mode: ALL active drivers
    if (config.mode === 'ALL') {
      const [activeDrivers] = await connection.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.role, d.license_plate, d.vehicle_type, d.current_shift_status
        FROM users u
        INNER JOIN drivers d ON u.id = d.user_id
        WHERE u.role = 'DRIVER' AND (d.current_shift_status != 'OFFLINE' OR d.current_shift_status IS NULL)
        ORDER BY u.full_name ASC
      `);

      if (activeDrivers && activeDrivers.length > 0) {
        return { drivers: activeDrivers };
      }

      // If no active drivers, fetch all drivers as fallback
      const [all] = await connection.query(`
        SELECT u.id, u.full_name, u.email, u.phone, u.role, d.license_plate, d.vehicle_type, d.current_shift_status
        FROM users u
        INNER JOIN drivers d ON u.id = d.user_id
        WHERE u.role = 'DRIVER'
        ORDER BY u.full_name ASC
      `);
      return { drivers: all };
    }

    // Mode: SINGLE driver search
    const searchPattern = `%${config.query}%`;
    const [rows] = await connection.query(
      `
      SELECT u.id, u.full_name, u.email, u.phone, u.role, d.license_plate, d.vehicle_type, d.current_shift_status
      FROM users u
      INNER JOIN drivers d ON u.id = d.user_id
      WHERE (u.full_name LIKE ? OR u.id = ? OR u.email LIKE ? OR d.license_plate LIKE ?)
        AND u.role = 'DRIVER'
      LIMIT 1
      `,
      [searchPattern, config.query, searchPattern, searchPattern]
    );

    if (rows && rows.length > 0) {
      return { drivers: [rows[0]] };
    }

    // Not found
    const [available] = await connection.query(`
      SELECT u.id, u.full_name, d.license_plate
      FROM users u
      INNER JOIN drivers d ON u.id = d.user_id
      WHERE u.role = 'DRIVER'
      ORDER BY u.full_name ASC
    `);

    return { notFound: true, available };
  } catch (err) {
    console.warn(`${YELLOW}⚠ Không thể kết nối trực tiếp MySQL (${err.message}). Sử dụng danh sách dự phòng.${RESET}`);
    const fallbacks = [
      { id: '2b093939-87b8-47b8-80e3-71ca1884fc12', full_name: 'Văn Hậu Trần', email: 'vanhautran592@gmail.com', role: 'DRIVER', license_plate: '59Y3-123.68', vehicle_type: 'MOTORBIKE' },
      { id: 'u0000000-0000-0000-0000-000000000103', full_name: 'Vũ Quốc Bảo (Xe tải Van 500kg)', email: 'driver03@smartexpress.vn', role: 'DRIVER', license_plate: '51D-890.12', vehicle_type: 'VAN_500KG' },
      { id: 'u0000000-0000-0000-0000-000000000108', full_name: 'Trương Gia Huy (Xe máy 05)', email: 'driver08@smartexpress.vn', role: 'DRIVER', license_plate: '59M2-778.89', vehicle_type: 'MOTORBIKE' },
      { id: 'u0000000-0000-0000-0000-000000000101', full_name: 'Ngô Văn Tài (Xe máy 01)', email: 'driver01@smartexpress.vn', role: 'DRIVER', license_plate: '59G1-234.56', vehicle_type: 'MOTORBIKE' },
      { id: 'u0000000-0000-0000-0000-000000000102', full_name: 'Phạm Hoàng Nam (Xe máy 02)', email: 'driver02@smartexpress.vn', role: 'DRIVER', license_plate: '59P1-345.67', vehicle_type: 'MOTORBIKE' },
      { id: 'u0000000-0000-0000-0000-000000000104', full_name: 'Đặng Minh Khôi (Xe tải 1 Tấn)', email: 'driver04@smartexpress.vn', role: 'DRIVER', license_plate: '51C-901.23', vehicle_type: 'TRUCK_1000KG' },
      { id: 'u0000000-0000-0000-0000-000000000105', full_name: 'Bùi Anh Tuấn (Xe máy 03)', email: 'driver05@smartexpress.vn', role: 'DRIVER', license_plate: '59S3-112.23', vehicle_type: 'MOTORBIKE' },
      { id: 'u0000000-0000-0000-0000-000000000106', full_name: 'Đỗ Thành Đạt (Xe máy 04)', email: 'driver06@smartexpress.vn', role: 'DRIVER', license_plate: '59V1-445.56', vehicle_type: 'MOTORBIKE' },
    ];

    if (config.mode === 'ALL') {
      return { drivers: fallbacks };
    }
    const match = fallbacks.find((f) => f.full_name.toLowerCase().includes(config.query.toLowerCase()) || f.id === config.query);
    if (match) return { drivers: [match] };
    return { notFound: true, available: fallbacks };
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ── Realistic Route in Ho Chi Minh City (Go Vap District / Around IUH) ────────
const WAYPOINTS = [
  [10.82753, 106.67931], // Cổng ĐH Công Nghiệp TP.HCM (IUH) - 12 Nguyễn Văn Bảo
  [10.82810, 106.68005], // Ngã 3 Nguyễn Văn Bảo - Nguyễn Thái Sơn
  [10.82915, 106.68120], // Đường Nguyễn Thái Sơn
  [10.83050, 106.68260], // Ngã 4 Nguyễn Thái Sơn - Phan Văn Trị
  [10.83220, 106.68050], // Phan Văn Trị (hướng về Emart)
  [10.83350, 106.67820], // Phan Văn Trị (gần Thống Nhất)
  [10.83510, 106.67510], // Ngã 4 Phan Văn Trị - Quang Trung
  [10.83380, 106.67380], // Đường Quang Trung
  [10.83150, 106.67250], // Vòng xoay Ngã Sáu Gò Vấp
  [10.82950, 106.67480], // Đường Nguyễn Oanh
  [10.82820, 106.67720], // Rẽ vào Nguyễn Văn Bảo
  [10.82753, 106.67931], // Hoàn tất vòng lặp
];

function buildSmoothPath(waypoints, stepsPerSegment = 8) {
  const path = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    for (let s = 0; s < stepsPerSegment; s++) {
      const ratio = s / stepsPerSegment;
      const lat = p1[0] + (p2[0] - p1[0]) * ratio;
      const lng = p1[1] + (p2[1] - p1[1]) * ratio;
      path.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
    }
  }
  return path;
}

const ROUTE = buildSmoothPath(WAYPOINTS, 8);

// ── Main Execution ────────────────────────────────────────────────────────────
async function main() {
  const config = parseConfig();

  // Mode: List drivers
  if (config.mode === 'LIST') {
    console.log(`${CYAN}${BOLD}📋 DANH SÁCH TÀI XẾ KHẢ DỤNG TRONG HỆ THỐNG:${RESET}\n`);
    const result = await fetchDriversFromDb(config);
    if (result.list) {
      result.list.forEach((d, idx) => {
        console.log(
          `  ${BOLD}${idx + 1}.${RESET} ${GREEN}${d.full_name}${RESET} ` +
          `| Biển số: ${YELLOW}${d.license_plate || 'N/A'}${RESET} ` +
          `| Trạng thái: ${d.current_shift_status || 'ONLINE_READY'} ` +
          `| ID: ${CYAN}${d.id}${RESET}`
        );
      });
      console.log(`\n${BLUE}💡 Cách chạy 1 tài xế: npm run simulate:driver -- "<Tên tài xế>"${RESET}`);
      console.log(`${BLUE}💡 Cách chạy TẤT CẢ:   npm run simulate:all${RESET}`);
    }
    process.exit(0);
  }

  // Fetch target driver(s)
  const result = await fetchDriversFromDb(config);

  if (result.notFound) {
    console.error(`\n${RED}${BOLD}✖ Không tìm thấy tài xế khớp với từ khóa:${RESET} "${YELLOW}${config.query}${RESET}"\n`);
    console.log(`${CYAN}Các tài xế hiện có trong hệ thống:${RESET}`);
    (result.available || []).forEach((d) => {
      console.log(`  • ${GREEN}${d.full_name}${RESET} (Biển số: ${d.license_plate || 'N/A'}) - ID: ${d.id}`);
    });
    console.log(`\n${YELLOW}Ví dụ chạy đúng:${RESET}`);
    console.log(`  npm run simulate:driver -- "Vũ Quốc Bảo"`);
    console.log(`  npm run simulate:all\n`);
    process.exit(1);
  }

  const drivers = result.drivers;
  const isMulti = drivers.length > 1;

  console.log(`${CYAN}${BOLD}╔═════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║              🚚 SMARTEXPRESS — DRIVER GPS SIMULATOR 🚚               ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═════════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`${MAGENTA}  Chế độ:${RESET}     ${BOLD}${isMulti ? `MÔ PHỎNG ĐỒNG THỜI TẤT CẢ (${drivers.length} TÀI XẾ)` : 'MÔ PHỎNG ĐƠN (1 TÀI XẾ)'}${RESET}`);
  console.log(`${MAGENTA}  Gateway:${RESET}    ${BACKEND_URL}`);
  console.log(`${MAGENTA}  Tần suất:${RESET}   Mỗi ${INTERVAL_MS / 1000}s (~19 pings/phút/tài xế, tuân thủ Rate Limit)`);
  console.log(`${MAGENTA}  Lộ trình:${RESET}   ${ROUTE.length} điểm tọa độ thực tế tại Q. Gò Vấp, TP.HCM\n`);

  if (isMulti) {
    console.log(`${BOLD}Danh sách ${drivers.length} tài xế đang được kích hoạt đồng thời:${RESET}`);
    drivers.forEach((d, idx) => {
      console.log(`  ${DIM}[${idx + 1}]${RESET} ${GREEN}${d.full_name}${RESET} (${d.license_plate || 'N/A'}) - ID: ${CYAN}${d.id.slice(0, 12)}...${RESET}`);
    });
    console.log('');
  } else {
    const single = drivers[0];
    console.log(`${MAGENTA}  Tài xế:${RESET}     ${BOLD}${single.full_name}${RESET} (${single.email})`);
    console.log(`${MAGENTA}  User ID:${RESET}    ${single.id}`);
    console.log(`${MAGENTA}  Biển số:${RESET}    ${single.license_plate || 'N/A'} · ${single.vehicle_type || 'MOTORBIKE'}\n`);
  }

  // ── Prepare Sockets for each Driver ──────────────────────────────────────────
  const activeSimulations = drivers.map((driver, index) => {
    // Generate JWT token
    const token = jwt.sign(
      {
        sub: driver.id,
        email: driver.email,
        role: driver.role || 'DRIVER',
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Socket client
    const socket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    // Stagger starting position along the route so drivers are spread across town
    const startIndex = Math.floor((index * ROUTE.length) / drivers.length) % ROUTE.length;

    // Slight lane offset (~12 meters) to avoid overlapping
    const latOffset = ((index % 3) - 1) * 0.00012;
    const lngOffset = (Math.floor(index / 3) - 1) * 0.00012;

    return {
      driver,
      socket,
      currentIndex: startIndex,
      latOffset,
      lngOffset,
      batteryLevel: 98 - (index * 2),
      connected: false,
    };
  });

  let totalEmitted = 0;
  let intervalTimer = null;

  // Track socket connections
  activeSimulations.forEach((sim) => {
    sim.socket.on('connect', () => {
      sim.connected = true;
      if (!isMulti) {
        console.log(`${GREEN}${BOLD}✔ Đã kết nối WebSocket Gateway thành công!${RESET} Socket ID: ${sim.socket.id}`);
        console.log(`${GREEN}✔ Xác thực thành công vai trò DRIVER: ${sim.driver.full_name}${RESET}`);
      }
      checkAllConnected();
    });

    sim.socket.on('disconnect', (reason) => {
      sim.connected = false;
    });

    sim.socket.on('connect_error', (error) => {
      console.error(`${RED}✖ Lỗi kết nối Socket (${sim.driver.full_name}):${RESET} ${error.message}`);
    });
  });

  function checkAllConnected() {
    const connectedCount = activeSimulations.filter((s) => s.connected).length;
    if (connectedCount === activeSimulations.length && !intervalTimer) {
      if (isMulti) {
        console.log(`${GREEN}${BOLD}✔ Toàn bộ ${activeSimulations.length} tài xế đã kết nối WebSocket Gateway thành công!${RESET}`);
      }
      console.log(`${YELLOW}▶ Đang phát sóng tọa độ GPS trực tiếp... (Bấm Ctrl+C để dừng)${RESET}\n`);

      sendGpsTick();
      intervalTimer = setInterval(sendGpsTick, INTERVAL_MS);
    }
  }

  // Fallback start if some sockets take longer
  setTimeout(() => {
    if (!intervalTimer) {
      const connectedCount = activeSimulations.filter((s) => s.connected).length;
      if (connectedCount > 0) {
        console.log(`${YELLOW}▶ Bắt đầu phát sóng cho ${connectedCount}/${activeSimulations.length} tài xế đã sẵn sàng...${RESET}\n`);
        sendGpsTick();
        intervalTimer = setInterval(sendGpsTick, INTERVAL_MS);
      }
    }
  }, 2500);

  function sendGpsTick() {
    totalEmitted++;
    const timestamp = new Date().toLocaleTimeString('vi-VN');

    activeSimulations.forEach((sim) => {
      if (!sim.connected) return;

      const rawPoint = ROUTE[sim.currentIndex];
      sim.currentIndex = (sim.currentIndex + 1) % ROUTE.length;

      // Apply lane offset
      const latitude = Number((rawPoint[0] + sim.latOffset).toFixed(6));
      const longitude = Number((rawPoint[1] + sim.lngOffset).toFixed(6));

      // Battery slow drain
      if (totalEmitted % 25 === 0 && sim.batteryLevel > 15) {
        sim.batteryLevel -= 1;
      }

      const payload = {
        latitude,
        longitude,
        batteryLevel: sim.batteryLevel,
      };

      sim.socket.emit('update_location', payload);
    });

    // Clean logging output
    if (isMulti) {
      console.log(
        `${GREEN}[${timestamp}] #${totalEmitted}${RESET} ` +
        `📡 ${BOLD}Đã phát sóng GPS đồng thời cho ${activeSimulations.length} tài xế${RESET} ` +
        `qua Gateway -> DB saved & dispatchers broadcast ✔`
      );
    } else {
      const sim = activeSimulations[0];
      const pt = ROUTE[sim.currentIndex];
      console.log(
        `${GREEN}[${timestamp}] #${totalEmitted}${RESET} ` +
        `🚗 ${BOLD}${sim.driver.full_name.split('(')[0].trim()}${RESET} ` +
        `📍 Lat: ${BOLD}${pt[0].toFixed(5)}${RESET}, Lng: ${BOLD}${pt[1].toFixed(5)}${RESET} ` +
        `| ⚡ ${sim.batteryLevel}% ` +
        `| ${CYAN}Đã lưu DB & broadcast tới dispatchers ✔${RESET}`
      );
    }
  }

  // Graceful Exit
  process.on('SIGINT', () => {
    console.log(`\n${YELLOW}Đang dừng giả lập GPS...${RESET}`);
    if (intervalTimer) clearInterval(intervalTimer);
    activeSimulations.forEach((sim) => sim.socket.disconnect());
    console.log(`${GREEN}Đã ngắt kết nối toàn bộ ${activeSimulations.length} tài xế an toàn. Hoàn tất!${RESET}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${RED}Lỗi khởi chạy giả lập:${RESET}`, err);
  process.exit(1);
});
