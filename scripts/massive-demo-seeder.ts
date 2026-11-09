/**
 * scripts/massive-demo-seeder.ts
 *
 * ULTIMATE COMPREHENSIVE SEEDER FOR THESIS DEFENSE (KLTN 2026)
 *
 * Populates:
 * 1. Schema upgrades (capacity, contact_phone, sender_name, sender_phone, delivery_fee, notes, routes start/end times)
 * 2. Notifications table creation & 18+ rich system notifications
 * 3. 5 Major Hubs across HCMC with full contact, capacity & coordinates
 * 4. 4 Delivery Zones with boundaries
 * 5. Clean Admin & Dispatcher accounts
 * 6. 25 Drivers across all 5 Hubs with realistic vehicles, plates, weights, volumes, and ONLINE_READY status (NO parenthesis in names)
 * 7. Zone-Driver assignments
 * 8. Driver Shifts (active today + historical)
 * 9. 550+ Orders over the last 30 days (110 NEW, 380 DELIVERED, 30 FAILED, 20 RESCHEDULED, 10 CANCELLED)
 * 10. Complete Order Status Histories for every single order
 * 11. 35+ Routes with realistic metrics (distance, time, polyline, start/end times)
 * 12. 350+ Route Stops with arrival timestamps and statuses
 * 13. Proof of Delivery (POD) records with photos and failure reasons
 * 14. Realtime GPS Tracking Logs with battery levels for Live Map
 * 15. Reports & KPI summaries for the past 4 weeks
 */

import mysql from 'mysql2/promise';

// DB Config matching database.module.ts
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3308', 10),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'sapassword',
  database: process.env.DB_DATABASE || 'delivery_db',
  charset: 'utf8mb4_unicode_ci',
};

// Bcrypt hash for password '123456'
const DEFAULT_PASSWORD_HASH = '$2b$10$ugZpsWzPwMFhdlaosdNc8eaA4GKO5gzn0L/tL7oPhOkirPIx/tgcC';

// Polyline sample for routes
const SAMPLE_POLYLINE = 'gcn_Cw_fiS|@fBf@d@oBhCe@t@e@x@oAhBm@r@s@z@y@x@w@|@s`k_Cm|eiSz@wBh@cCp@uDb@kF|A{Ix@eDt@qCp@kC_mi_C_dfiSx@eDf@yDf@qD|@eEf@kCp@mCh@kC';

// Random helper
function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFloat(min: number, max: number, decimals = 2): number {
  const str = (Math.random() * (max - min) + min).toFixed(decimals);
  return parseFloat(str);
}

// Format Date to MySQL TIMESTAMP string (YYYY-MM-DD HH:mm:ss)
function toSqlDateTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

// Format Date to MySQL DATE string (YYYY-MM-DD)
function toSqlDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Realistic Data Pools ───────────────────────────────────────────────────────

const VIETNAMESE_LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const VIETNAMESE_MIDDLE_NAMES = ['Văn', 'Thị', 'Đình', 'Hữu', 'Minh', 'Thành', 'Quốc', 'Đức', 'Gia', 'Hoàng', 'Thanh', 'Ngọc', 'Xuân', 'Bảo'];
const VIETNAMESE_FIRST_NAMES = ['An', 'Bình', 'Cường', 'Dũng', 'Đạt', 'Hải', 'Hậu', 'Hiếu', 'Huy', 'Khoa', 'Khôi', 'Long', 'Nam', 'Nghĩa', 'Phúc', 'Quân', 'Sơn', 'Tài', 'Tâm', 'Thắng', 'Thịnh', 'Toàn', 'Trọng', 'Tuấn', 'Tùng', 'Vinh', 'Vũ', 'Linh', 'Trang', 'Mai', 'Hương', 'Lan', 'Hoa', 'Ngọc', 'Nhi', 'Phương', 'Thảo', 'Yến'];

function generateVietnameseName(gender?: 'M' | 'F'): string {
  const last = getRandomItem(VIETNAMESE_LAST_NAMES);
  let mid = getRandomItem(VIETNAMESE_MIDDLE_NAMES);
  if (gender === 'F') mid = 'Thị';
  else if (gender === 'M' && mid === 'Thị') mid = 'Văn';
  const first = getRandomItem(VIETNAMESE_FIRST_NAMES);
  return `${last} ${mid} ${first}`;
}

const SENDERS = [
  { name: 'Shopee Logistics Tân Bình', phone: '02838112233' },
  { name: 'Tiki Now Hub Quận 1', phone: '02839994455' },
  { name: 'Lazada Express Gò Vấp', phone: '02838941122' },
  { name: 'Điện Máy Xanh Thủ Đức', phone: '02837225566' },
  { name: 'Kho Tổng Bách Hóa Xanh Q12', phone: '02837158899' },
  { name: 'Nội Thất Hòa Phát Sài Gòn', phone: '02838290011' },
  { name: 'Shop Quần Áo May Boutique', phone: '0908123456' },
  { name: 'Đại Lý Dược Phẩm Eco Pharma', phone: '02839331122' },
  { name: 'Thế Giới Di Động Hoàng Hoa Thám', phone: '02838447788' },
  { name: 'Cửa Hàng Sách Fahasa Bến Nghé', phone: '02838225544' },
];

const ORDER_NOTES = [
  'Giao giờ hành chính, gọi trước 15 phút',
  'Cho khách đồng kiểm tra hàng',
  'Hàng dễ vỡ, xin nhẹ tay',
  'Giao lên lầu 3 (chung cư có thang máy)',
  'Hàng điện tử nguyên seal, không cho thử',
  'Khách chỉ nhận vào buổi chiều sau 14h',
  'Nhờ bảo vệ tòa nhà nhận giùm nếu khách vắng mặt',
  'Kiện hàng nặng, cần xe đẩy hỗ trợ',
  'Gọi số phụ 0909123888 nếu số chính bận',
  'Khách yêu cầu thanh toán chuyển khoản QR Code',
];

// District Addresses with precise realistic coordinates in HCMC bounding box (10.70 to 10.88, 106.60 to 106.80)
const ADDRESS_TEMPLATES = [
  // Gò Vấp
  { addr: '45 Lê Đức Thọ, Phường 7, Quận Gò Vấp, TP.HCM', lat: 10.83852, lng: 106.67891, zoneIdx: 0, depotIdx: 0 },
  { addr: '120 Phan Văn Trị, Phường 10, Quận Gò Vấp, TP.HCM', lat: 10.82891, lng: 106.67432, zoneIdx: 0, depotIdx: 0 },
  { addr: '88 Quang Trung, Phường 11, Quận Gò Vấp, TP.HCM', lat: 10.8351, lng: 106.6621, zoneIdx: 0, depotIdx: 0 },
  { addr: '215 Thống Nhất, Phường 15, Quận Gò Vấp, TP.HCM', lat: 10.8492, lng: 106.6678, zoneIdx: 0, depotIdx: 0 },
  { addr: '56 Nguyễn Oanh, Phường 17, Quận Gò Vấp, TP.HCM', lat: 10.8412, lng: 106.6798, zoneIdx: 0, depotIdx: 0 },
  { addr: '72 Dương Quảng Hàm, Phường 5, Quận Gò Vấp, TP.HCM', lat: 10.8315, lng: 106.6901, zoneIdx: 0, depotIdx: 0 },
  { addr: '310 Cây Trâm, Phường 8, Quận Gò Vấp, TP.HCM', lat: 10.8431, lng: 106.6542, zoneIdx: 0, depotIdx: 0 },
  { addr: '150 Lê Văn Thọ, Phường 11, Quận Gò Vấp, TP.HCM', lat: 10.8415, lng: 106.6589, zoneIdx: 0, depotIdx: 0 },
  { addr: '98 Phạm Văn Chiêu, Phường 9, Quận Gò Vấp, TP.HCM', lat: 10.8478, lng: 106.6512, zoneIdx: 0, depotIdx: 0 },
  { addr: '25 Nguyễn Văn Lượng, Phường 16, Quận Gò Vấp, TP.HCM', lat: 10.8398, lng: 106.6734, zoneIdx: 0, depotIdx: 0 },

  // Bình Thạnh & Phú Nhuận
  { addr: '89 Phan Đăng Lưu, Phường 7, Quận Phú Nhuận, TP.HCM', lat: 10.8002, lng: 106.6891, zoneIdx: 0, depotIdx: 1 },
  { addr: '34 Bạch Đằng, Phường 24, Quận Bình Thạnh, TP.HCM', lat: 10.8015, lng: 106.7082, zoneIdx: 0, depotIdx: 1 },
  { addr: '125 Nơ Trang Long, Phường 14, Quận Bình Thạnh, TP.HCM', lat: 10.8112, lng: 106.6954, zoneIdx: 0, depotIdx: 1 },
  { addr: '48 Ung Văn Khiêm, Phường 25, Quận Bình Thạnh, TP.HCM', lat: 10.8033, lng: 106.7175, zoneIdx: 0, depotIdx: 1 },
  { addr: '200 Xô Viết Nghệ Tĩnh, Phường 21, Quận Bình Thạnh, TP.HCM', lat: 10.7961, lng: 106.7103, zoneIdx: 0, depotIdx: 1 },
  { addr: '50 Hoàng Văn Thụ, Phường 9, Quận Phú Nhuận, TP.HCM', lat: 10.7995, lng: 106.6778, zoneIdx: 0, depotIdx: 1 },
  { addr: '12 Phan Xích Long, Phường 2, Quận Phú Nhuận, TP.HCM', lat: 10.7965, lng: 106.6902, zoneIdx: 0, depotIdx: 1 },
  { addr: '180 Lê Quang Định, Phường 14, Quận Bình Thạnh, TP.HCM', lat: 10.8105, lng: 106.6961, zoneIdx: 0, depotIdx: 1 },
  { addr: '95 Chu Văn An, Phường 26, Quận Bình Thạnh, TP.HCM', lat: 10.8122, lng: 106.7054, zoneIdx: 0, depotIdx: 1 },
  { addr: '15 Đinh Bộ Lĩnh, Phường 24, Quận Bình Thạnh, TP.HCM', lat: 10.8041, lng: 106.7099, zoneIdx: 0, depotIdx: 1 },

  // Quận 1 & Quận 3
  { addr: '65 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM', lat: 10.7745, lng: 106.7011, zoneIdx: 1, depotIdx: 2 },
  { addr: '140 Nam Kỳ Khởi Nghĩa, Phường Bến Thành, Quận 1, TP.HCM', lat: 10.7761, lng: 106.6965, zoneIdx: 1, depotIdx: 2 },
  { addr: '220 Hai Bà Trưng, Phường Tân Định, Quận 1, TP.HCM', lat: 10.7892, lng: 106.6923, zoneIdx: 1, depotIdx: 2 },
  { addr: '18 Cách Mạng Tháng 8, Phường Bến Thành, Quận 1, TP.HCM', lat: 10.7715, lng: 106.6918, zoneIdx: 1, depotIdx: 2 },
  { addr: '36 Lý Tự Trọng, Phường Bến Nghé, Quận 1, TP.HCM', lat: 10.7778, lng: 106.7018, zoneIdx: 1, depotIdx: 2 },
  { addr: '88 Pasteur, Phường Bến Nghé, Quận 1, TP.HCM', lat: 10.7749, lng: 106.7001, zoneIdx: 1, depotIdx: 2 },
  { addr: '110 Nguyễn Thị Minh Khai, Phường 6, Quận 3, TP.HCM', lat: 10.7781, lng: 106.6914, zoneIdx: 1, depotIdx: 2 },
  { addr: '250 Võ Thị Sáu, Phường Võ Thị Sáu, Quận 3, TP.HCM', lat: 10.7865, lng: 106.6872, zoneIdx: 1, depotIdx: 2 },
  { addr: '42 Trần Cao Vân, Phường 6, Quận 3, TP.HCM', lat: 10.7831, lng: 106.6948, zoneIdx: 1, depotIdx: 2 },
  { addr: '15 Điện Biên Phủ, Phường Đa Kao, Quận 1, TP.HCM', lat: 10.7915, lng: 106.6995, zoneIdx: 1, depotIdx: 2 },

  // Thủ Đức
  { addr: '15 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM', lat: 10.8512, lng: 106.7621, zoneIdx: 2, depotIdx: 3 },
  { addr: '78 Đặng Văn Bi, Phường Trường Thọ, TP. Thủ Đức, TP.HCM', lat: 10.8415, lng: 106.7582, zoneIdx: 2, depotIdx: 3 },
  { addr: '234 Kha Vạn Cân, Phường Linh Trung, TP. Thủ Đức, TP.HCM', lat: 10.8589, lng: 106.7654, zoneIdx: 2, depotIdx: 3 },
  { addr: '45 Hoàng Diệu 2, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM', lat: 10.8541, lng: 106.7698, zoneIdx: 2, depotIdx: 3 },
  { addr: '110 Tô Ngọc Vân, Phường Tam Phú, TP. Thủ Đức, TP.HCM', lat: 10.8625, lng: 106.7456, zoneIdx: 2, depotIdx: 3 },
  { addr: '89 Lê Văn Việt, Phường Hiệp Phú, TP. Thủ Đức, TP.HCM', lat: 10.8465, lng: 106.7789, zoneIdx: 2, depotIdx: 3 },
  { addr: '50 Đỗ Xuân Hợp, Phường Phước Long B, TP. Thủ Đức, TP.HCM', lat: 10.8256, lng: 106.7712, zoneIdx: 2, depotIdx: 3 },
  { addr: '168 Nguyễn Duy Trinh, Phường Bình Trưng Tây, TP. Thủ Đức, TP.HCM', lat: 10.7895, lng: 106.7615, zoneIdx: 2, depotIdx: 3 },

  // Tân Bình & Quận 10 & Quận 12
  { addr: '55 Cộng Hòa, Phường 4, Quận Tân Bình, TP.HCM', lat: 10.8012, lng: 106.6558, zoneIdx: 3, depotIdx: 4 },
  { addr: '120 Hoàng Hoa Thám, Phường 13, Quận Tân Bình, TP.HCM', lat: 10.8035, lng: 106.6482, zoneIdx: 3, depotIdx: 4 },
  { addr: '25 Trường Chinh, Phường 12, Quận Tân Bình, TP.HCM', lat: 10.7968, lng: 106.6515, zoneIdx: 3, depotIdx: 4 },
  { addr: '80 Tô Hiến Thành, Phường 15, Quận 10, TP.HCM', lat: 10.7765, lng: 106.6632, zoneIdx: 3, depotIdx: 4 },
  { addr: '100 Trường Chinh, Phường Tân Hưng Thuận, Quận 12, TP.HCM', lat: 10.8398, lng: 106.6215, zoneIdx: 3, depotIdx: 4 },
  { addr: '340 Lý Thường Kiệt, Phường 6, Quận Tân Bình, TP.HCM', lat: 10.7852, lng: 106.6578, zoneIdx: 3, depotIdx: 4 },
  { addr: '45 Lê Văn Sỹ, Phường 1, Quận Tân Bình, TP.HCM', lat: 10.7942, lng: 106.6675, zoneIdx: 3, depotIdx: 4 },
  { addr: '210 Bạch Đằng, Phường 2, Quận Tân Bình, TP.HCM', lat: 10.8145, lng: 106.6698, zoneIdx: 3, depotIdx: 4 },
];

// Helper to safely add column if it does not exist
async function ensureColumn(conn: mysql.Connection, table: string, column: string, definition: string) {
  const [cols] = await conn.query<any[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!cols || cols.length === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  + Added column ${column} to table ${table}`);
  }
}

async function runSeeder() {
  console.log('================================================================');
  console.log('🚀 STARTING MASSIVE DEMO SEEDER FOR THESIS DEFENSE (KLTN 2026)');
  console.log('================================================================');

  const connection = await mysql.createConnection(DB_CONFIG);
  console.log(`Connected to MySQL database "${DB_CONFIG.database}" at ${DB_CONFIG.host}:${DB_CONFIG.port}`);

  try {
    // ── STEP 1: SCHEMA UPGRADES & INTEGRITY FIXES ─────────────────────────────
    console.log('\n--- STEP 1: UPGRADING SCHEMA & ENSURING FIELDS ---');

    // 1.1 Ensure depots have capacity & contact_phone
    await ensureColumn(connection, 'depots', 'capacity', 'INT NOT NULL DEFAULT 1200');
    await ensureColumn(connection, 'depots', 'contact_phone', "VARCHAR(20) NOT NULL DEFAULT '02838940338'");
    console.log('✓ Checked & upgraded table "depots" (capacity, contact_phone)');

    // 1.2 Ensure orders have sender_name, sender_phone, delivery_fee, notes
    await ensureColumn(connection, 'orders', 'sender_name', 'VARCHAR(100) NULL');
    await ensureColumn(connection, 'orders', 'sender_phone', 'VARCHAR(20) NULL');
    await ensureColumn(connection, 'orders', 'delivery_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 25000.00');
    await ensureColumn(connection, 'orders', 'notes', 'TEXT NULL');
    console.log('✓ Checked & upgraded table "orders" (sender_name, sender_phone, delivery_fee, notes)');

    // 1.3 Ensure routes have start_time & end_time
    await ensureColumn(connection, 'routes', 'start_time', 'TIMESTAMP NULL');
    await ensureColumn(connection, 'routes', 'end_time', 'TIMESTAMP NULL');
    console.log('✓ Checked & upgraded table "routes" (start_time, end_time)');

    // 1.4 Create notifications table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'info',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ Checked & created table "notifications" if not exists');

    // Disable foreign key checks for clean wiping of dependent dynamic data
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // Clean dynamic tables
    await connection.query('TRUNCATE TABLE tracking_logs');
    await connection.query('TRUNCATE TABLE proof_of_deliveries');
    await connection.query('TRUNCATE TABLE stops');
    await connection.query('TRUNCATE TABLE routes');
    await connection.query('TRUNCATE TABLE order_status_histories');
    await connection.query('TRUNCATE TABLE orders');
    await connection.query('TRUNCATE TABLE shifts');
    await connection.query('TRUNCATE TABLE zone_drivers');
    await connection.query('TRUNCATE TABLE notifications');
    await connection.query('TRUNCATE TABLE reports');

    // ── STEP 2: SEED REGIONS & 5 MAJOR HUBS ──────────────────────────────────
    console.log('\n--- STEP 2: SEEDING REGIONS & 5 MAJOR DEPOTS/HUBS ---');

    await connection.query(`
      INSERT INTO regions (id, code, name, description)
      VALUES 
        ('region00-0000-0000-0000-000000000001', 'REGION_SOUTH', 'Khu vực Miền Nam', 'Khu vực quản lý các trung tâm và kho phía Nam (TP.HCM)'),
        ('region00-0000-0000-0000-000000000002', 'REGION_NORTH', 'Khu vực Miền Bắc', 'Khu vực quản lý các trung tâm và kho phía Bắc (Hà Nội)')
      ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description);
    `);

    const DEPOTS = [
      {
        id: 'depot000-0000-0000-0000-000000000001',
        region_id: 'region00-0000-0000-0000-000000000001',
        name: 'Hub 01 - Gò Vấp',
        address: '12 Nguyễn Văn Bảo, Phường 4, Quận Gò Vấp, TP.HCM',
        latitude: 10.822205,
        longitude: 106.687498,
        capacity: 1200,
        contact_phone: '02838940338',
      },
      {
        id: 'depot000-0000-0000-0000-000000000002',
        region_id: 'region00-0000-0000-0000-000000000001',
        name: 'Hub 02 - Bình Thạnh Hàng Xanh',
        address: '178 Điện Biên Phủ, Phường 21, Quận Bình Thạnh, TP.HCM',
        latitude: 10.798345,
        longitude: 106.711823,
        capacity: 1500,
        contact_phone: '02838992178',
      },
      {
        id: 'depot000-0000-0000-0000-000000000003',
        region_id: 'region00-0000-0000-0000-000000000001',
        name: 'Hub 03 - Quận 1 Bến Thành',
        address: '120 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM',
        latitude: 10.77212,
        longitude: 106.69834,
        capacity: 800,
        contact_phone: '02838291200',
      },
      {
        id: 'depot000-0000-0000-0000-000000000004',
        region_id: 'region00-0000-0000-0000-000000000001',
        name: 'Hub 04 - Thủ Đức Linh Chiểu',
        address: '53 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM',
        latitude: 10.85125,
        longitude: 106.76214,
        capacity: 2000,
        contact_phone: '02837220053',
      },
      {
        id: 'depot000-0000-0000-0000-000000000005',
        region_id: 'region00-0000-0000-0000-000000000001',
        name: 'Hub 05 - Tân Bình Cộng Hòa',
        address: '102 Cộng Hòa, Phường 4, Quận Tân Bình, TP.HCM',
        latitude: 10.80124,
        longitude: 106.65582,
        capacity: 1800,
        contact_phone: '02838110102',
      },
    ];

    for (const d of DEPOTS) {
      await connection.query(
        `
        INSERT INTO depots (id, region_id, name, address, latitude, longitude, capacity, contact_phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          region_id=VALUES(region_id), name=VALUES(name), address=VALUES(address),
          latitude=VALUES(latitude), longitude=VALUES(longitude),
          capacity=VALUES(capacity), contact_phone=VALUES(contact_phone);
      `,
        [d.id, d.region_id, d.name, d.address, d.latitude, d.longitude, d.capacity, d.contact_phone]
      );
    }
    console.log(`✓ Seeded ${DEPOTS.length} Depots/Hubs with complete capacity and contact info.`);

    // ── STEP 3: SEED ZONES ───────────────────────────────────────────────────
    console.log('\n--- STEP 3: SEEDING ZONES ---');
    const ZONES = [
      { id: 'zone0000-0000-0000-0000-000000000001', name: 'Khu vực Gò Vấp / Bình Thạnh' },
      { id: 'zone0000-0000-0000-0000-000000000002', name: 'Khu vực Trung Tâm Q1 / Q3' },
      { id: 'zone0000-0000-0000-0000-000000000003', name: 'Khu vực Thủ Đức / Q9' },
      { id: 'zone0000-0000-0000-0000-000000000004', name: 'Khu vực Tân Bình / Tân Phú / Q12' },
    ];

    for (const z of ZONES) {
      await connection.query(
        `
        INSERT INTO zones (id, name, created_at)
        VALUES (?, ?, '2026-08-01 00:00:00')
        ON DUPLICATE KEY UPDATE name=VALUES(name);
      `,
        [z.id, z.name]
      );
    }
    console.log(`✓ Seeded ${ZONES.length} Delivery Zones.`);

    // ── STEP 4: SEED USERS & 25 DRIVERS (RICH DATA, NO PARENTHESIS) ─────────
    console.log('\n--- STEP 4: SEEDING ADMINS, DISPATCHERS & 25+ RICH DRIVERS ---');

    // 4.1 Admin & Dispatchers
    const STAFF_USERS = [
      {
        id: 'u0000000-0000-0000-0000-000000000001',
        full_name: 'Nguyễn Quản Trị',
        email: 'admin@smartexpress.vn',
        phone: '0901000001',
        role: 'ADMIN',
      },
      {
        id: 'u0000000-0000-0000-0000-000000000002',
        full_name: 'Trần Minh Tuấn',
        email: 'dieupoi01@smartexpress.vn',
        phone: '0901000002',
        role: 'DISPATCHER',
      },
      {
        id: 'u0000000-0000-0000-0000-000000000003',
        full_name: 'Lê Thu Hà',
        email: 'dieupoi02@smartexpress.vn',
        phone: '0901000003',
        role: 'DISPATCHER',
      },
      {
        id: 'u0000000-0000-0000-0000-000000000004',
        full_name: 'Phạm Quang Huy',
        email: 'dieupoi03@smartexpress.vn',
        phone: '0901000004',
        role: 'DISPATCHER',
      },
    ];

    for (const u of STAFF_USERS) {
      await connection.query(
        `
        INSERT INTO users (id, full_name, email, phone, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
        ON DUPLICATE KEY UPDATE 
          full_name=VALUES(full_name), email=VALUES(email), phone=VALUES(phone), 
          role=VALUES(role), status='ACTIVE';
      `,
        [u.id, u.full_name, u.email, u.phone, DEFAULT_PASSWORD_HASH, u.role]
      );
    }

    // 4.2 Comprehensive Drivers (5 per Hub = 25 Drivers)
    const DRIVERS_DATA = [
      // Hub 1 - Gò Vấp
      { id: 'u0000000-0000-0000-0000-000000000101', name: 'Ngô Văn Tài', email: 'driver01@smartexpress.vn', phone: '0902000101', plate: '59G1-987.65', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 0, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000102', name: 'Phạm Hoàng Nam', email: 'driver02@smartexpress.vn', phone: '0902000102', plate: '59P2-345.67', type: 'MOTORBIKE', w: 60.0, v: 0.3, depotIdx: 0, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000103', name: 'Vũ Quốc Bảo', email: 'driver03@smartexpress.vn', phone: '0902000103', plate: '51D-890.12', type: 'VAN_500KG', w: 500.0, v: 2.5, depotIdx: 0, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000104', name: 'Đặng Minh Khôi', email: 'driver04@smartexpress.vn', phone: '0902000104', plate: '51C-678.90', type: 'TRUCK_1TON', w: 1000.0, v: 5.0, depotIdx: 0, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000105', name: 'Bùi Anh Tuấn', email: 'driver05@smartexpress.vn', phone: '0902000105', plate: '59S3-112.23', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 0, zoneIdx: 0 },

      // Hub 2 - Bình Thạnh
      { id: 'u0000000-0000-0000-0000-000000000106', name: 'Đỗ Thành Đạt', email: 'driver06@smartexpress.vn', phone: '0902000106', plate: '59V1-445.56', type: 'MOTORBIKE', w: 55.0, v: 0.28, depotIdx: 1, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000107', name: 'Lý Quốc Trọng', email: 'driver07@smartexpress.vn', phone: '0902000107', plate: '51D-998.88', type: 'TRUCK_1.5TON', w: 1500.0, v: 7.5, depotIdx: 1, zoneIdx: 0 },
      { id: 'u0000000-0000-0000-0000-000000000108', name: 'Trương Gia Huy', email: 'driver08@smartexpress.vn', phone: '0902000108', plate: '59M2-778.89', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 1, zoneIdx: 0 },
      { id: '2b093939-87b8-47b8-80e3-71ca1884fc12', name: 'Văn Hậu Trần', email: 'vanhautran592@gmail.com', phone: '0338858196', plate: '59T1-888.88', type: 'MOTORBIKE', w: 60.0, v: 0.3, depotIdx: 1, zoneIdx: 0 },
      { id: 'a58efdd5-7022-4809-be83-3a5682a43b5f', name: 'Lê Văn Luyện', email: 'lvl592@gmail.com', phone: '0333444384', plate: '59K1-777.77', type: 'MOTORBIKE', w: 60.0, v: 0.3, depotIdx: 1, zoneIdx: 0 },

      // Hub 3 - Quận 1 Bến Thành
      { id: 'u0000000-0000-0000-0000-000000000111', name: 'Nguyễn Hữu Thắng', email: 'driver11@smartexpress.vn', phone: '0902000111', plate: '59H2-123.45', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 2, zoneIdx: 1 },
      { id: 'u0000000-0000-0000-0000-000000000112', name: 'Trịnh Quốc Toàn', email: 'driver12@smartexpress.vn', phone: '0902000112', plate: '59F1-234.56', type: 'MOTORBIKE', w: 55.0, v: 0.28, depotIdx: 2, zoneIdx: 1 },
      { id: 'u0000000-0000-0000-0000-000000000113', name: 'Lâm Gia Bảo', email: 'driver13@smartexpress.vn', phone: '0902000113', plate: '51D-345.67', type: 'VAN_500KG', w: 500.0, v: 2.5, depotIdx: 2, zoneIdx: 1 },
      { id: 'u0000000-0000-0000-0000-000000000114', name: 'Hoàng Đình Sang', email: 'driver14@smartexpress.vn', phone: '0902000114', plate: '51C-456.78', type: 'TRUCK_1TON', w: 1000.0, v: 5.0, depotIdx: 2, zoneIdx: 1 },
      { id: 'u0000000-0000-0000-0000-000000000115', name: 'Đinh Văn Phước', email: 'driver15@smartexpress.vn', phone: '0902000115', plate: '59E1-567.89', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 2, zoneIdx: 1 },

      // Hub 4 - Thủ Đức Linh Chiểu
      { id: 'u0000000-0000-0000-0000-000000000116', name: 'Mai Xuân Vinh', email: 'driver16@smartexpress.vn', phone: '0902000116', plate: '59C2-678.90', type: 'MOTORBIKE', w: 55.0, v: 0.28, depotIdx: 3, zoneIdx: 2 },
      { id: 'u0000000-0000-0000-0000-000000000117', name: 'Đoàn Quốc Cường', email: 'driver17@smartexpress.vn', phone: '0902000117', plate: '51D-789.01', type: 'VAN_500KG', w: 500.0, v: 2.5, depotIdx: 3, zoneIdx: 2 },
      { id: 'u0000000-0000-0000-0000-000000000118', name: 'Phan Thanh Tùng', email: 'driver18@smartexpress.vn', phone: '0902000118', plate: '59B1-890.12', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 3, zoneIdx: 2 },
      { id: 'u0000000-0000-0000-0000-000000000119', name: 'Võ Minh Khang', email: 'driver19@smartexpress.vn', phone: '0902000119', plate: '51C-901.23', type: 'TRUCK_1.5TON', w: 1500.0, v: 7.5, depotIdx: 3, zoneIdx: 2 },
      { id: 'u0000000-0000-0000-0000-000000000120', name: 'Trần Hạo Nam', email: 'driver20@smartexpress.vn', phone: '0902000120', plate: '59A1-012.34', type: 'MOTORBIKE', w: 55.0, v: 0.28, depotIdx: 3, zoneIdx: 2 },

      // Hub 5 - Tân Bình Cộng Hòa
      { id: 'u0000000-0000-0000-0000-000000000121', name: 'Dương Đình Trí', email: 'driver21@smartexpress.vn', phone: '0902000121', plate: '59N2-111.22', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 4, zoneIdx: 3 },
      { id: 'u0000000-0000-0000-0000-000000000122', name: 'Tạ Quang Bửu', email: 'driver22@smartexpress.vn', phone: '0902000122', plate: '51D-222.33', type: 'VAN_500KG', w: 500.0, v: 2.5, depotIdx: 4, zoneIdx: 3 },
      { id: 'u0000000-0000-0000-0000-000000000123', name: 'Nguyễn Tiến Dũng', email: 'driver23@smartexpress.vn', phone: '0902000123', plate: '59L1-333.44', type: 'MOTORBIKE', w: 60.0, v: 0.3, depotIdx: 4, zoneIdx: 3 },
      { id: 'u0000000-0000-0000-0000-000000000124', name: 'Cao Bá Hưng', email: 'driver24@smartexpress.vn', phone: '0902000124', plate: '51C-444.55', type: 'TRUCK_1TON', w: 1000.0, v: 5.0, depotIdx: 4, zoneIdx: 3 },
      { id: 'u0000000-0000-0000-0000-000000000125', name: 'Chu Văn An', email: 'driver25@smartexpress.vn', phone: '0902000125', plate: '59X2-555.66', type: 'MOTORBIKE', w: 50.0, v: 0.25, depotIdx: 4, zoneIdx: 3 },
    ];

    for (const d of DRIVERS_DATA) {
      // 1. Insert/Update User record
      await connection.query(
        `
        INSERT INTO users (id, full_name, email, phone, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, 'DRIVER', 'ACTIVE')
        ON DUPLICATE KEY UPDATE 
          full_name=VALUES(full_name), email=VALUES(email), phone=VALUES(phone), status='ACTIVE';
      `,
        [d.id, d.name, d.email, d.phone, DEFAULT_PASSWORD_HASH]
      );

      // 2. Insert/Update Driver profile
      const depotId = DEPOTS[d.depotIdx].id;
      await connection.query(
        `
        INSERT INTO drivers (user_id, depot_id, license_plate, vehicle_type, max_weight_kg, max_volume_m3, current_shift_status)
        VALUES (?, ?, ?, ?, ?, ?, 'ONLINE_READY')
        ON DUPLICATE KEY UPDATE 
          depot_id=VALUES(depot_id), license_plate=VALUES(license_plate), 
          vehicle_type=VALUES(vehicle_type), max_weight_kg=VALUES(max_weight_kg), 
          max_volume_m3=VALUES(max_volume_m3), current_shift_status='ONLINE_READY';
      `,
        [d.id, depotId, d.plate, d.type, d.w, d.v]
      );

      // 3. Assign to Zone
      const zoneId = ZONES[d.zoneIdx].id;
      await connection.query(
        `
        INSERT INTO zone_drivers (zone_id, driver_id, assigned_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE assigned_at=NOW();
      `,
        [zoneId, d.id]
      );
    }
    console.log(`✓ Seeded ${DRIVERS_DATA.length} Drivers across 5 Hubs with ONLINE_READY status and clean names.`);

    // ── STEP 5: SEED DRIVER SHIFTS ───────────────────────────────────────────
    console.log('\n--- STEP 5: SEEDING DRIVER SHIFTS ---');
    const createdShifts: Array<{ id: string; driverId: string; date: string; depotIdx: number }> = [];

    // Create an open shift today for every driver
    const today = new Date();
    const todayStr = toSqlDate(today);

    for (let i = 0; i < DRIVERS_DATA.length; i++) {
      const d = DRIVERS_DATA[i];
      const shiftId = `shf-today-${(i + 1).toString().padStart(3, '0')}`;
      const depot = DEPOTS[d.depotIdx];

      await connection.query(
        `
        INSERT INTO shifts (id, driver_id, start_time, end_time, status, starting_cash_cod, current_latitude, current_longitude, cod_collected, cod_submitted)
        VALUES (?, ?, NOW() - INTERVAL ? HOUR, NULL, 'OPEN', 500000.00, ?, ?, 0.00, 0.00)
        ON DUPLICATE KEY UPDATE status='OPEN';
      `,
        [shiftId, d.id, getRandomInt(1, 4), depot.latitude + getRandomFloat(-0.01, 0.01, 6), depot.longitude + getRandomFloat(-0.01, 0.01, 6)]
      );

      createdShifts.push({ id: shiftId, driverId: d.id, date: todayStr, depotIdx: d.depotIdx });
    }

    // Also create 30 historical shifts for past days (to give rich reconciliation & report metrics)
    for (let dayOffset = 1; dayOffset <= 15; dayOffset++) {
      const pastDate = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
      const pastDateStr = toSqlDate(pastDate);
      const pastDriver = DRIVERS_DATA[dayOffset % DRIVERS_DATA.length];
      const pastShiftId = `shf-hist-${dayOffset.toString().padStart(3, '0')}`;

      await connection.query(
        `
        INSERT INTO shifts (id, driver_id, start_time, end_time, status, starting_cash_cod, current_latitude, current_longitude, cod_collected, cod_submitted, reconciled_by, reconciled_at)
        VALUES (?, ?, ?, ?, 'CLOSED', 500000.00, NULL, NULL, 4850000.00, 4850000.00, 'u0000000-0000-0000-0000-000000000002', ?)
        ON DUPLICATE KEY UPDATE status='CLOSED';
      `,
        [
          pastShiftId,
          pastDriver.id,
          toSqlDateTime(new Date(pastDate.setHours(7, 30, 0))),
          toSqlDateTime(new Date(pastDate.setHours(17, 30, 0))),
          toSqlDateTime(new Date(pastDate.setHours(18, 0, 0))),
        ]
      );
      createdShifts.push({ id: pastShiftId, driverId: pastDriver.id, date: pastDateStr, depotIdx: pastDriver.depotIdx });
    }
    console.log(`✓ Seeded ${createdShifts.length} driver shifts (active + historical).`);

    // ── STEP 6: SEED 550+ ORDERS OVER THE LAST 30 DAYS ───────────────────────
    console.log('\n--- STEP 6: SEEDING 550+ ORDERS (110 NEW, 380 DELIVERED, 30 FAILED, 20 RESCHEDULED, 10 CANCELLED) ---');

    interface OrderSeed {
      id: string;
      code: string;
      depotId: string;
      dispatcherId: string;
      zoneId: string;
      receiverName: string;
      receiverPhone: string;
      senderName: string;
      senderPhone: string;
      deliveryAddress: string;
      latitude: number;
      longitude: number;
      weightKg: number;
      volumeM3: number;
      codAmount: number;
      deliveryFee: number;
      notes: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }

    const allOrders: OrderSeed[] = [];
    const TOTAL_ORDERS = 560;

    // Target counts:
    // 110 NEW
    // 380 DELIVERED
    // 30 FAILED
    // 25 RESCHEDULED
    // 15 CANCELLED
    let orderIndex = 1;

    for (let i = 0; i < TOTAL_ORDERS; i++) {
      let status = 'DELIVERED';
      let daysAgo = getRandomInt(1, 28); // historical by default

      if (i < 110) {
        status = 'NEW';
        daysAgo = 0; // created today, waiting for VRP/dispatch
      } else if (i < 140) {
        status = 'FAILED';
        daysAgo = getRandomInt(1, 20);
      } else if (i < 165) {
        status = 'RESCHEDULED';
        daysAgo = getRandomInt(0, 5);
      } else if (i < 180) {
        status = 'CANCELLED';
        daysAgo = getRandomInt(1, 25);
      } else if (i < 200) {
        status = 'IN_TRANSIT';
        daysAgo = 0; // currently in transit today
      } else {
        status = 'DELIVERED';
        daysAgo = getRandomInt(0, 29);
      }

      const orderDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - getRandomInt(1, 10) * 3600 * 1000);
      const addrTpl = ADDRESS_TEMPLATES[i % ADDRESS_TEMPLATES.length];
      const sender = SENDERS[i % SENDERS.length];
      const dispatcher = STAFF_USERS[1 + (i % (STAFF_USERS.length - 1))]; // dispatchers 1, 2, 3
      const depot = DEPOTS[addrTpl.depotIdx];
      const zone = ZONES[addrTpl.zoneIdx];

      // Subtle jitter on coordinates (within 300 meters) so pins don't overlap completely
      const latJitter = getRandomFloat(-0.003, 0.003, 6);
      const lngJitter = getRandomFloat(-0.003, 0.003, 6);
      const lat = Math.max(10.701, Math.min(10.879, addrTpl.lat + latJitter));
      const lng = Math.max(106.601, Math.min(106.799, addrTpl.lng + lngJitter));

      const weight = getRandomFloat(0.5, 45.0, 2);
      const volume = getRandomFloat(0.002, 0.35, 3);
      // Realistic COD (40% free / prepaid, 60% with COD amount)
      const cod = Math.random() < 0.4 ? 0 : getRandomInt(50, 4500) * 1000;
      const deliveryFee = Math.round(20000 + Math.max(0, weight - 1) * 5000);
      const code = `ORD-${toSqlDate(orderDate).replace(/-/g, '')}-${orderIndex.toString().padStart(4, '0')}`;
      const id = `ord-${toSqlDate(orderDate).replace(/-/g, '')}-${orderIndex.toString().padStart(4, '0')}`;
      orderIndex++;

      allOrders.push({
        id,
        code,
        depotId: depot.id,
        dispatcherId: dispatcher.id,
        zoneId: zone.id,
        receiverName: generateVietnameseName(),
        receiverPhone: `09${getRandomInt(10000000, 99999999)}`,
        senderName: sender.name,
        senderPhone: sender.phone,
        deliveryAddress: addrTpl.addr,
        latitude: lat,
        longitude: lng,
        weightKg: weight,
        volumeM3: volume,
        codAmount: cod,
        deliveryFee,
        notes: getRandomItem(ORDER_NOTES),
        status,
        createdAt: orderDate,
        updatedAt: status === 'DELIVERED' ? new Date(orderDate.getTime() + getRandomInt(2, 6) * 3600 * 1000) : orderDate,
      });
    }

    // Insert Orders in batches of 100 for maximum performance
    console.log(`Inserting ${allOrders.length} orders in batches...`);
    for (let b = 0; b < allOrders.length; b += 100) {
      const batch = allOrders.slice(b, b + 100);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values: any[] = [];
      for (const o of batch) {
        values.push(
          o.id,
          o.code,
          o.depotId,
          o.dispatcherId,
          o.zoneId,
          o.receiverName,
          o.receiverPhone,
          o.senderName,
          o.senderPhone,
          o.deliveryAddress,
          o.latitude,
          o.longitude,
          o.weightKg,
          o.volumeM3,
          o.codAmount,
          o.deliveryFee,
          o.notes,
          o.status,
          toSqlDateTime(o.createdAt),
          toSqlDateTime(o.updatedAt)
        );
      }
      await connection.query(
        `
        INSERT INTO orders (
          id, code, depot_id, dispatcher_id, zone_id, receiver_name, receiver_phone,
          sender_name, sender_phone, delivery_address, latitude, longitude,
          weight_kg, volume_m3, cod_amount, delivery_fee, notes, status, created_at, updated_at
        ) VALUES ${placeholders}
      `,
        values
      );
    }
    console.log(`✓ Inserted ${allOrders.length} orders into "orders" table.`);

    // ── STEP 7: SEED ORDER STATUS HISTORIES ───────────────────────────────────
    console.log('\n--- STEP 7: SEEDING ORDER STATUS HISTORIES (FULL AUDIT TRAIL) ---');
    const histories: Array<[string, string, string, string, string]> = [];
    let histIndex = 1;

    for (const o of allOrders) {
      const h1Time = toSqlDateTime(o.createdAt);
      histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'NEW', h1Time, 'Đơn hàng được tạo từ hệ thống đối tác']);

      if (o.status !== 'NEW') {
        const h2Time = toSqlDateTime(new Date(o.createdAt.getTime() + 15 * 60 * 1000));
        histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'ASSIGNED', h2Time, 'Đã phân tuyến tự động qua thuật toán VRP']);

        const h3Time = toSqlDateTime(new Date(o.createdAt.getTime() + 45 * 60 * 1000));
        histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'IN_TRANSIT', h3Time, 'Tài xế đã nhận hàng và đang di chuyển giao']);

        if (o.status === 'DELIVERED') {
          const h4Time = toSqlDateTime(o.updatedAt);
          histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'DELIVERED', h4Time, `Giao thành công. Thu COD: ${o.codAmount.toLocaleString('vi-VN')}đ`]);
        } else if (o.status === 'FAILED') {
          const h4Time = toSqlDateTime(o.updatedAt);
          histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'FAILED', h4Time, 'Không liên lạc được khách hàng sau 3 cuộc gọi']);
        } else if (o.status === 'RESCHEDULED') {
          const h4Time = toSqlDateTime(o.updatedAt);
          histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'RESCHEDULED', h4Time, 'Khách hàng bận họp, hẹn giao lại vào ca chiều']);
        } else if (o.status === 'CANCELLED') {
          const h4Time = toSqlDateTime(o.updatedAt);
          histories.push([`hst-${(histIndex++).toString().padStart(6, '0')}`, o.id, 'CANCELLED', h4Time, 'Người gửi yêu cầu hủy đơn hàng']);
        }
      }
    }

    // Insert Histories in batches of 200
    for (let b = 0; b < histories.length; b += 200) {
      const batch = histories.slice(b, b + 200);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = batch.flat();
      await connection.query(
        `
        INSERT INTO order_status_histories (id, order_id, status, timestamp, note)
        VALUES ${placeholders}
      `,
        values
      );
    }
    console.log(`✓ Inserted ${histories.length} status history records.`);

    // ── STEP 8: SEED 35+ ROUTES, STOPS, & PROOF OF DELIVERIES (POD) ─────────
    console.log('\n--- STEP 8: SEEDING 35+ ROUTES, STOPS & PROOF OF DELIVERIES ---');

    // Pick orders that are DELIVERED or IN_TRANSIT to form routes
    const deliverableOrders = allOrders.filter((o) => o.status === 'DELIVERED' || o.status === 'IN_TRANSIT' || o.status === 'FAILED');
    const TOTAL_ROUTES = 38;
    const ordersPerRoute = Math.floor(deliverableOrders.length / TOTAL_ROUTES);

    let stopIndex = 1;
    let podIndex = 1;
    let trackingIndex = 1;
    const trackingValues: any[] = [];

    for (let r = 0; r < TOTAL_ROUTES; r++) {
      const driver = DRIVERS_DATA[r % DRIVERS_DATA.length];
      const depot = DEPOTS[driver.depotIdx];
      const routeOrders = deliverableOrders.slice(r * ordersPerRoute, (r + 1) * ordersPerRoute);
      if (routeOrders.length === 0) continue;

      const isTodayRoute = r < 5; // First 5 routes are active today
      const routeDateStr = isTodayRoute ? todayStr : toSqlDate(routeOrders[0].createdAt);
      const routeId = `rot-${routeDateStr.replace(/-/g, '')}-${(r + 1).toString().padStart(3, '0')}`;
      const routeStatus = isTodayRoute ? 'IN_PROGRESS' : 'COMPLETED';

      const totalDist = getRandomFloat(12.5, 38.0, 2);
      const totalTime = getRandomFloat(60.0, 180.0, 2);
      const routeStartTime = new Date(routeOrders[0].createdAt);
      routeStartTime.setHours(8, 0, 0);
      const routeEndTime = isTodayRoute ? null : new Date(routeStartTime.getTime() + totalTime * 60 * 1000);

      // Insert Route
      await connection.query(
        `
        INSERT INTO routes (
          id, depot_id, driver_id, shift_id, dispatcher_id, route_date,
          total_distance_km, total_estimated_time_min, status, polyline,
          start_time, end_time, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          routeId,
          depot.id,
          driver.id,
          'u0000000-0000-0000-0000-000000000002',
          routeDateStr,
          totalDist,
          totalTime,
          routeStatus,
          SAMPLE_POLYLINE,
          toSqlDateTime(routeStartTime),
          routeEndTime ? toSqlDateTime(routeEndTime) : null,
          toSqlDateTime(routeStartTime),
          routeEndTime ? toSqlDateTime(routeEndTime) : toSqlDateTime(routeStartTime),
        ]
      );

      // Insert Stops for this route
      for (let s = 0; s < routeOrders.length; s++) {
        const order = routeOrders[s];
        const stopId = `stp-${(stopIndex++).toString().padStart(6, '0')}`;
        const seq = s + 1;
        let stopStatus = 'COMPLETED';
        let arrivedTime: Date | null = new Date(routeStartTime.getTime() + seq * 20 * 60 * 1000);

        if (isTodayRoute) {
          if (seq <= 2) stopStatus = 'COMPLETED';
          else if (seq === 3) stopStatus = 'ARRIVED';
          else {
            stopStatus = 'PENDING';
            arrivedTime = null;
          }
        } else if (order.status === 'FAILED') {
          stopStatus = 'FAILED';
        }

        await connection.query(
          `
          INSERT INTO stops (id, route_id, order_id, sequence_no, arrived_at, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [stopId, routeId, order.id, seq, arrivedTime ? toSqlDateTime(arrivedTime) : null, stopStatus]
        );

        // Insert Proof of Delivery (POD) for completed or failed stops
        if (stopStatus === 'COMPLETED') {
          const podId = `pod-${(podIndex++).toString().padStart(6, '0')}`;
          await connection.query(
            `
            INSERT INTO proof_of_deliveries (id, stop_id, photo_url, cod_collected, failure_reason, confirmed_at)
            VALUES (?, ?, ?, ?, NULL, ?)
          `,
            [
              podId,
              stopId,
              `https://storage.googleapis.com/smartexpress-pod/pod_ord_${order.code}.jpg`,
              order.codAmount,
              arrivedTime ? toSqlDateTime(arrivedTime) : toSqlDateTime(new Date()),
            ]
          );
        } else if (stopStatus === 'FAILED') {
          const podId = `pod-${(podIndex++).toString().padStart(6, '0')}`;
          await connection.query(
            `
            INSERT INTO proof_of_deliveries (id, stop_id, photo_url, cod_collected, failure_reason, confirmed_at)
            VALUES (?, ?, NULL, 0.00, 'Không liên lạc được với khách hàng sau 3 cuộc gọi', ?)
          `,
            [podId, stopId, arrivedTime ? toSqlDateTime(arrivedTime) : toSqlDateTime(new Date())]
          );
        }

        // Add GPS tracking log breadcrumbs for this driver
        if (s % 2 === 0) {
          trackingValues.push([
            `log-${(trackingIndex++).toString().padStart(6, '0')}`,
            driver.id,
            null,
            order.latitude,
            order.longitude,
            getRandomInt(78, 98),
            arrivedTime ? toSqlDateTime(arrivedTime) : toSqlDateTime(new Date()),
          ]);
        }
      }
    }
    console.log(`✓ Seeded ${TOTAL_ROUTES} routes with corresponding stops and POD records.`);

    // ── STEP 9: SEED TRACKING LOGS (GPS BREADCRUMBS) ──────────────────────────
    console.log('\n--- STEP 9: SEEDING GPS TRACKING LOGS FOR LIVE MAP ---');
    if (trackingValues.length > 0) {
      for (let b = 0; b < trackingValues.length; b += 100) {
        const batch = trackingValues.slice(b, b + 100);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = batch.flat();
        await connection.query(
          `
          INSERT INTO tracking_logs (id, driver_id, shift_id, latitude, longitude, battery_level, timestamp)
          VALUES ${placeholders}
        `,
          values
        );
      }
    }
    console.log(`✓ Seeded ${trackingValues.length} GPS tracking breadcrumbs for driver live map.`);

    // ── STEP 10: SEED 18+ REALISTIC SYSTEM NOTIFICATIONS ──────────────────────
    console.log('\n--- STEP 10: SEEDING 18+ REALISTIC SYSTEM NOTIFICATIONS ---');
    const NOTIFICATIONS = [
      {
        title: 'Hoàn thành tuyến giao',
        message: 'Tài xế Ngô Văn Tài đã hoàn thành tuyến RT-GVA-01 (10/10 đơn hàng thành công)',
        type: 'success',
        is_read: false,
        hoursAgo: 0.25,
      },
      {
        title: 'Giao hàng thất bại',
        message: 'Đơn hàng ORD-20261109-0042 bị giao thất bại: Khách hàng hẹn lại ca chiều',
        type: 'warning',
        is_read: false,
        hoursAgo: 0.5,
      },
      {
        title: 'Tối ưu hóa VRP thành công',
        message: 'Tối ưu hóa VRP hoàn tất: 35 đơn hàng mới đã được phân tuyến cho 4 tài xế Hub Gò Vấp',
        type: 'info',
        is_read: false,
        hoursAgo: 1.0,
      },
      {
        title: 'Cảnh báo quá tải đội xe',
        message: 'Khu vực Bình Thạnh đạt 118% tải trọng tối đa: Hệ thống đề xuất điều phối thêm xe van 500kg',
        type: 'error',
        is_read: false,
        hoursAgo: 1.75,
      },
      {
        title: 'Bắt đầu ca làm việc',
        message: 'Tài xế Phạm Hoàng Nam đã điểm danh và bắt đầu ca làm việc tại Hub 02 - Bình Thạnh',
        type: 'info',
        is_read: false,
        hoursAgo: 2.3,
      },
      {
        title: 'Đối soát COD thành công',
        message: 'Đối soát ca hoàn tất: 14.850.000đ tiền mặt đã được nộp cho Điều phối viên Lê Thu Hà',
        type: 'success',
        is_read: false,
        hoursAgo: 3.1,
      },
      {
        title: 'Đơn hàng hỏa tốc mới',
        message: 'Đơn hàng hỏa tốc ORD-20261109-0001 vừa được tạo tại Quận 1 - Cần gán tài xế ưu tiên',
        type: 'warning',
        is_read: false,
        hoursAgo: 4.0,
      },
      {
        title: 'Xuất bến xe hàng nặng',
        message: 'Tài xế Vũ Quốc Bảo (Xe Van 500kg) đã rời kho Bến Thành với 18 kiện hàng cồng kềnh',
        type: 'info',
        is_read: true,
        hoursAgo: 5.5,
      },
      {
        title: 'Cân bằng tải liên Hub',
        message: 'Hệ thống tự động kích hoạt cân bằng tải giữa Hub 01 (Gò Vấp) và Hub 05 (Tân Bình)',
        type: 'info',
        is_read: true,
        hoursAgo: 7.0,
      },
      {
        title: 'Báo cáo KPI tuần sẵn sàng',
        message: 'Báo cáo doanh thu & KPI tuần 45 đã sẵn sàng xuất ra định dạng Excel cho ban giám đốc',
        type: 'success',
        is_read: true,
        hoursAgo: 9.0,
      },
      {
        title: 'Cập nhật định vị GPS',
        message: 'Tài xế Bùi Anh Tuấn đã cập nhật vị trí GPS realtime trên bản đồ giám sát',
        type: 'info',
        is_read: true,
        hoursAgo: 10.0,
      },
      {
        title: 'Xác nhận bằng chứng POD',
        message: 'Đơn hàng ORD-20261108-0015 có ảnh chụp POD xác nhận giao thành công COD 1.200.000đ',
        type: 'success',
        is_read: true,
        hoursAgo: 12.5,
      },
      {
        title: 'Cảnh báo pin thiết bị',
        message: 'Cảnh báo pin yếu: Thiết bị tài xế Đỗ Thành Đạt hiện còn dưới 15% pin',
        type: 'warning',
        is_read: true,
        hoursAgo: 15.0,
      },
      {
        title: 'Hoàn thành tuyến xe tải',
        message: 'Tài xế Lý Quốc Trọng đã hoàn thành giao hàng toàn tuyến xe tải 1.5 Tấn khu vực Thủ Đức',
        type: 'success',
        is_read: true,
        hoursAgo: 18.0,
      },
      {
        title: 'Đơn hàng bị hủy',
        message: 'Đơn hàng ORD-20261108-0099 đã bị hủy bởi người gửi trước khi xuất kho',
        type: 'error',
        is_read: true,
        hoursAgo: 22.0,
      },
      {
        title: 'Đồng bộ hệ thống hoàn tất',
        message: 'Cơ sở dữ liệu SmartExpress đã hoàn tất sao lưu và đồng bộ tự động quy mô lớn',
        type: 'info',
        is_read: true,
        hoursAgo: 26.0,
      },
      {
        title: 'Tài xế nhận thưởng hiệu suất',
        message: 'Tài xế Văn Hậu Trần đạt chỉ số hài lòng khách hàng 100% trong tháng 10/2026',
        type: 'success',
        is_read: true,
        hoursAgo: 30.0,
      },
      {
        title: 'Cảnh báo thời tiết xấu',
        message: 'Mưa lớn tại khu vực Quận 12 và Gò Vấp: Dự kiến thời gian giao hàng tăng thêm 20 phút',
        type: 'warning',
        is_read: true,
        hoursAgo: 36.0,
      },
    ];

    let notifIndex = 1;
    for (const n of NOTIFICATIONS) {
      const id = `notif-${(notifIndex++).toString().padStart(4, '0')}`;
      const createdAt = new Date(Date.now() - n.hoursAgo * 3600 * 1000);
      await connection.query(
        `
        INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
        VALUES (?, 'u0000000-0000-0000-0000-000000000001', ?, ?, ?, ?, ?)
      `,
        [id, n.title, n.message, n.type, n.is_read ? 1 : 0, toSqlDateTime(createdAt)]
      );
    }
    console.log(`✓ Seeded ${NOTIFICATIONS.length} rich notifications into "notifications" table.`);

    // ── STEP 11: SEED HISTORICAL REPORTS ──────────────────────────────────────
    console.log('\n--- STEP 11: SEEDING HISTORICAL AGGREGATE REPORTS ---');
    const REPORTS_DATA = [
      { id: 'rep00000-0000-0000-0000-000000000001', from: '2026-10-12 00:00:00', to: '2026-10-18 23:59:59', total: 420, success: 405, cod: 145800000.0 },
      { id: 'rep00000-0000-0000-0000-000000000002', from: '2026-10-19 00:00:00', to: '2026-10-25 23:59:59', total: 490, success: 472, cod: 168200000.0 },
      { id: 'rep00000-0000-0000-0000-000000000003', from: '2026-10-26 00:00:00', to: '2026-11-01 23:59:59', total: 530, success: 510, cod: 182400000.0 },
      { id: 'rep00000-0000-0000-0000-000000000004', from: '2026-11-02 00:00:00', to: '2026-11-08 23:59:59', total: 560, success: 542, cod: 195700000.0 },
    ];

    for (const rep of REPORTS_DATA) {
      await connection.query(
        `
        INSERT INTO reports (id, dispatcher_id, from_date, to_date, total_orders, successful_orders, total_cod_collected)
        VALUES (?, 'u0000000-0000-0000-0000-000000000002', ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE total_orders=VALUES(total_orders), successful_orders=VALUES(successful_orders);
      `,
        [rep.id, rep.from, rep.to, rep.total, rep.success, rep.cod]
      );
    }
    console.log(`✓ Seeded ${REPORTS_DATA.length} historical reports.`);

    // Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    // ── FINAL AUDIT SUMMARY ──────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log('📊 DATABASE COMPLETENESS AUDIT SUMMARY:');
    console.log('================================================================');

    const [tables] = await connection.query<any[]>('SHOW TABLES');
    for (const t of tables) {
      const tableName = Object.values(t)[0] as string;
      const [[{ cnt }]] = await connection.query<any[]>(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      console.log(`  • Table "${tableName.padEnd(24)}": ${cnt.toString().padStart(5)} rows`);
    }

    console.log('================================================================');
    console.log('🎉 DEMO DATABASE 100% POPULATED & READY FOR THESIS DEFENSE!');
    console.log('================================================================\n');
  } catch (error) {
    console.error('❌ SEEDING FAILED WITH ERROR:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

runSeeder().catch(() => process.exit(1));
