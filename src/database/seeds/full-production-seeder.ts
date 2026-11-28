/**
 * src/database/seeds/full-production-seeder.ts
 *
 * COMPREHENSIVE 14-TABLE PRODUCTION-LIKE DATABASE SEEDER (HCMC LOGISTICS — 90 DAYS + LIVE TODAY)
 * Run via: npm run seed:full
 *
 * Covers all 14 TypeORM Entity tables (+ notifications & reports tables if present):
 *  1. regions               — 1 Region (HCM - TP. Hồ Chí Minh)
 *  2. depots                — 5 Hubs in HCMC with real coordinates
 *  3. users                 — 29 Users (1 ADMIN, 3 DISPATCHER, 25 DRIVER), password '123456' (bcrypt)
 *  4. drivers               — 25 Drivers (5 per Hub: 3 MOTORBIKE, 1 VAN_500KG, 1 TRUCK_1TON)
 *  5. zones                 — 6 non-overlapping realistic GeoJSON Polygons across HCMC
 *  6. zone_drivers          — 25 strict 1-to-1 driver-zone assignments (Single-Zone Exclusivity)
 *  7. orders                — ~720 historical 90-day orders + 96 NEW VRP Demo orders at Hub 01 + 32 live route orders
 *  8. order_status_histories— Full lifecycle audit trail for every order
 *  9. routes                — Historical COMPLETED routes + 4 live IN_PROGRESS routes (valid JSON polylines)
 * 10. stops                 — Ordered route stops (COMPLETED, ARRIVED, PENDING, FAILED, SKIPPED)
 * 11. proof_of_deliveries   — Local POD photos (/uploads/pod/*.jpg), COD collected, failure reasons & future reschedule lock
 * 12. shifts                — CLOSED reconciled shifts, PENDING_SETTLEMENT shifts (with realistic COD discrepancies), and OPEN shifts today
 * 13. tracking_logs         — Recent GPS pings (< 2 mins ago) for all 25 drivers on real HCMC roads + route breadcrumbs
 * 14. password_resets       — Realistic OTP/token audit records
 */

import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// ─── Load .env safely without requiring extra runtime flags ───────────────────

function loadDotEnv(): void {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

// ─── Deterministic Seeded PRNG (Mulberry32) ───────────────────────────────────

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(20261127);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals: number): number {
  const val = rng() * (max - min) + min;
  return Number(val.toFixed(decimals));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function formatSqlDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatSqlDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeUuid(prefix8: string, seq: number): string {
  const clean = prefix8
    .replace(/[^0-9a-f]/gi, '0')
    .padEnd(8, '0')
    .slice(0, 8)
    .toLowerCase();
  return `${clean}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildSmoothPolyline(points: [number, number][]): string {
  if (points.length < 2) return JSON.stringify(points);
  const dense: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[i + 1];
    dense.push([Number(lat1.toFixed(6)), Number(lng1.toFixed(6))]);
    // Midpoint with subtle street-grid jog so polylines look realistic on maps
    const midLat = (lat1 + lat2) / 2 + (i % 2 === 0 ? 0.00045 : -0.00035);
    const midLng = (lng1 + lng2) / 2 + (i % 2 === 0 ? -0.00035 : 0.00045);
    dense.push([Number(midLat.toFixed(6)), Number(midLng.toFixed(6))]);
  }
  const last = points[points.length - 1];
  dense.push([Number(last[0].toFixed(6)), Number(last[1].toFixed(6))]);
  return JSON.stringify(dense);
}

// ─── Batch Insert Helper ──────────────────────────────────────────────────────

type SqlPrimitive = string | number | boolean | null;

async function batchInsert(
  conn: Connection,
  table: string,
  columns: string[],
  rows: SqlPrimitive[][],
  chunkSize = 250,
): Promise<void> {
  if (rows.length === 0) return;
  const colList = columns.map((c) => `\`${c}\``).join(', ');
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const placeholders = slice.map(() => rowPlaceholder).join(', ');
    const flatValues: SqlPrimitive[] = [];
    for (const r of slice) {
      for (const v of r) flatValues.push(v);
    }
    await conn.query(`INSERT INTO \`${table}\` (${colList}) VALUES ${placeholders}`, flatValues);
  }
}

// ─── Local POD Sample Photo Generator ─────────────────────────────────────────

async function ensureLocalPodImages(): Promise<void> {
  const podDir = path.resolve(__dirname, '../../../uploads/pod');
  fs.mkdirSync(podDir, { recursive: true });

  const specs = [
    {
      filename: 'pod-sample-1.jpg',
      accent: '#059669',
      badge: 'DA GIAO THANH CONG',
      subtitle: 'Kien hang nguyen ven - Khach hang da ky nhan',
      code: 'POD-GV-01',
    },
    {
      filename: 'pod-sample-2.jpg',
      accent: '#0284C7',
      badge: 'XAC NHAN GIAO HANG',
      subtitle: 'Giao tai sảnh lễ tân / Cửa hàng - Đã thu đủ COD',
      code: 'POD-SG-02',
    },
    {
      filename: 'pod-sample-3.jpg',
      accent: '#0F172A',
      badge: 'HOAN TAT DIEM DUNG',
      subtitle: 'Bưu kiện đóng gói chuẩn SmartExpress Logistics',
      code: 'POD-HCM-03',
    },
    {
      filename: 'pod-failed-1.jpg',
      accent: '#DC2626',
      badge: 'GHI NHAN HIEN TRUONG',
      subtitle: 'Cửa đóng / Không liên lạc được người nhận',
      code: 'POD-FAIL-01',
    },
  ];

  for (const spec of specs) {
    const targetPath = path.join(podDir, spec.filename);
    const svg = `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="480" fill="#F1F5F9"/>
      <rect x="24" y="24" width="592" height="432" rx="12" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>
      <rect x="24" y="24" width="592" height="64" rx="12" fill="#0F172A"/>
      <text x="48" y="63" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">SMART EXPRESS LOGISTICS — POD</text>
      <rect x="420" y="38" width="176" height="36" rx="6" fill="${spec.accent}"/>
      <text x="508" y="61" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF">${spec.badge}</text>
      <rect x="190" y="130" width="260" height="190" rx="10" fill="#E2E8F0" stroke="#94A3B8" stroke-width="2"/>
      <rect x="205" y="145" width="230" height="160" rx="6" fill="#FEF3C7" stroke="#D97706" stroke-width="2"/>
      <line x1="320" y1="145" x2="320" y2="305" stroke="#D97706" stroke-width="8"/>
      <rect x="245" y="205" width="150" height="54" rx="4" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="320" y="229" text-anchor="middle" font-family="monospace" font-size="14" font-weight="bold" fill="#0F172A">${spec.code}</text>
      <text x="320" y="249" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#475569">TP. HO CHI MINH</text>
      <text x="320" y="366" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#0F172A">${spec.subtitle}</text>
      <text x="320" y="398" text-anchor="middle" font-family="monospace" font-size="13" fill="#64748B">GPS Verified • SmartExpress Driver App • HCMC</text>
    </svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(targetPath);
  }
}

// ─── Reference Geography & Realistic HCMC Datasets ────────────────────────────

const REGION_HCM = {
  id: 'region00-0000-0000-0000-000000000001',
  code: 'HCM',
  name: 'TP. Hồ Chí Minh',
  description:
    'Vùng vận hành trọng điểm TP. Hồ Chí Minh — Mạng lưới 5 Hub điều phối nội thành và TP. Thủ Đức.',
};

interface DepotSeed {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  phone: string;
  defaultZoneIdx: number;
}

const DEPOTS: DepotSeed[] = [
  {
    id: 'depot000-0000-0000-0000-000000000001',
    name: 'Hub 01 - Gò Vấp',
    address: '190 Quang Trung, Phường 10, Quận Gò Vấp, TP. Hồ Chí Minh',
    lat: 10.8326,
    lng: 106.6675,
    capacity: 2500,
    phone: '02838941101',
    defaultZoneIdx: 0,
  },
  {
    id: 'depot000-0000-0000-0000-000000000002',
    name: 'Hub 02 - Bình Thạnh',
    address: '475A Điện Biên Phủ, Phường 25, Quận Bình Thạnh, TP. Hồ Chí Minh',
    lat: 10.8018,
    lng: 106.7112,
    capacity: 2200,
    phone: '02838992202',
    defaultZoneIdx: 1,
  },
  {
    id: 'depot000-0000-0000-0000-000000000003',
    name: 'Hub 03 - Quận 1 Bến Thành',
    address: '136 Lê Lợi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    lat: 10.7725,
    lng: 106.698,
    capacity: 1800,
    phone: '02838223303',
    defaultZoneIdx: 2,
  },
  {
    id: 'depot000-0000-0000-0000-000000000004',
    name: 'Hub 04 - Thủ Đức Linh Chiểu',
    address: '216 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh',
    lat: 10.8512,
    lng: 106.7621,
    capacity: 2800,
    phone: '02838964404',
    defaultZoneIdx: 3,
  },
  {
    id: 'depot000-0000-0000-0000-000000000005',
    name: 'Hub 05 - Tân Bình Cộng Hòa',
    address: '364 Cộng Hòa, Phường 13, Quận Tân Bình, TP. Hồ Chí Minh',
    lat: 10.8012,
    lng: 106.6558,
    capacity: 2400,
    phone: '02838105505',
    defaultZoneIdx: 4,
  },
];

// 6 strictly non-overlapping HCMC GeoJSON Polygons (GeoJSON coordinate order: [lng, lat])
interface ZoneSeed {
  id: string;
  name: string;
  polygon: [number, number][];
  streets: { street: string; ward: string; district: string; lat: number; lng: number }[];
}

const ZONES: ZoneSeed[] = [
  {
    id: 'zone0000-0000-0000-0000-000000000001',
    name: 'Zone 01 - Quận Gò Vấp',
    polygon: [
      [106.646, 10.821],
      [106.668, 10.8185],
      [106.6905, 10.822],
      [106.691, 10.846],
      [106.674, 10.8555],
      [106.648, 10.851],
      [106.646, 10.821],
    ],
    streets: [
      {
        street: 'Quang Trung',
        ward: 'Phường 10',
        district: 'Quận Gò Vấp',
        lat: 10.8342,
        lng: 106.6662,
      },
      {
        street: 'Phan Văn Trị',
        ward: 'Phường 7',
        district: 'Quận Gò Vấp',
        lat: 10.8286,
        lng: 106.6788,
      },
      {
        street: 'Nguyễn Oanh',
        ward: 'Phường 17',
        district: 'Quận Gò Vấp',
        lat: 10.8418,
        lng: 106.6775,
      },
      {
        street: 'Lê Đức Thọ',
        ward: 'Phường 15',
        district: 'Quận Gò Vấp',
        lat: 10.8462,
        lng: 106.6695,
      },
      {
        street: 'Nguyễn Văn Lượng',
        ward: 'Phường 16',
        district: 'Quận Gò Vấp',
        lat: 10.8385,
        lng: 106.6728,
      },
      {
        street: 'Thống Nhất',
        ward: 'Phường 11',
        district: 'Quận Gò Vấp',
        lat: 10.8408,
        lng: 106.6632,
      },
      {
        street: 'Phạm Văn Chiêu',
        ward: 'Phường 14',
        district: 'Quận Gò Vấp',
        lat: 10.8482,
        lng: 106.6565,
      },
      {
        street: 'Lê Văn Thọ',
        ward: 'Phường 9',
        district: 'Quận Gò Vấp',
        lat: 10.8438,
        lng: 106.6588,
      },
      {
        street: 'Dương Quảng Hàm',
        ward: 'Phường 5',
        district: 'Quận Gò Vấp',
        lat: 10.8258,
        lng: 106.6852,
      },
      {
        street: 'Nguyễn Thái Sơn',
        ward: 'Phường 4',
        district: 'Quận Gò Vấp',
        lat: 10.8218,
        lng: 106.6815,
      },
      {
        street: 'Nguyễn Văn Khối',
        ward: 'Phường 8',
        district: 'Quận Gò Vấp',
        lat: 10.8392,
        lng: 106.6548,
      },
      {
        street: 'Phan Huy Ích',
        ward: 'Phường 12',
        district: 'Quận Gò Vấp',
        lat: 10.8365,
        lng: 106.6498,
      },
      {
        street: 'Nguyễn Văn Bảo',
        ward: 'Phường 4',
        district: 'Quận Gò Vấp',
        lat: 10.8224,
        lng: 106.6868,
      },
      {
        street: 'Lê Quang Định',
        ward: 'Phường 1',
        district: 'Quận Gò Vấp',
        lat: 10.8212,
        lng: 106.6882,
      },
    ],
  },
  {
    id: 'zone0000-0000-0000-0000-000000000002',
    name: 'Zone 02 - Quận Bình Thạnh',
    polygon: [
      [106.6955, 10.792],
      [106.718, 10.791],
      [106.7315, 10.802],
      [106.731, 10.824],
      [106.709, 10.826],
      [106.6955, 10.816],
      [106.6955, 10.792],
    ],
    streets: [
      {
        street: 'Điện Biên Phủ',
        ward: 'Phường 25',
        district: 'Quận Bình Thạnh',
        lat: 10.8015,
        lng: 106.7128,
      },
      {
        street: 'Xô Viết Nghệ Tĩnh',
        ward: 'Phường 21',
        district: 'Quận Bình Thạnh',
        lat: 10.8045,
        lng: 106.7105,
      },
      {
        street: 'Bạch Đằng',
        ward: 'Phường 15',
        district: 'Quận Bình Thạnh',
        lat: 10.8032,
        lng: 106.7042,
      },
      {
        street: 'Nơ Trang Long',
        ward: 'Phường 13',
        district: 'Quận Bình Thạnh',
        lat: 10.8165,
        lng: 106.7025,
      },
      {
        street: 'Ung Văn Khiêm',
        ward: 'Phường 25',
        district: 'Quận Bình Thạnh',
        lat: 10.8068,
        lng: 106.7212,
      },
      {
        street: 'Nguyễn Gia Trí',
        ward: 'Phường 25',
        district: 'Quận Bình Thạnh',
        lat: 10.8042,
        lng: 106.7165,
      },
      {
        street: 'Nguyễn Hữu Cảnh',
        ward: 'Phường 22',
        district: 'Quận Bình Thạnh',
        lat: 10.7945,
        lng: 106.7192,
      },
      {
        street: 'Đinh Bộ Lĩnh',
        ward: 'Phường 26',
        district: 'Quận Bình Thạnh',
        lat: 10.8118,
        lng: 106.7098,
      },
    ],
  },
  {
    id: 'zone0000-0000-0000-0000-000000000003',
    name: 'Zone 03 - Quận 1 & Quận 3',
    polygon: [
      [106.6785, 10.764],
      [106.699, 10.7625],
      [106.7085, 10.774],
      [106.706, 10.7875],
      [106.685, 10.788],
      [106.6785, 10.778],
      [106.6785, 10.764],
    ],
    streets: [
      {
        street: 'Lê Lợi',
        ward: 'Phường Bến Thành',
        district: 'Quận 1',
        lat: 10.7732,
        lng: 106.6992,
      },
      {
        street: 'Nguyễn Huệ',
        ward: 'Phường Bến Nghé',
        district: 'Quận 1',
        lat: 10.7748,
        lng: 106.7032,
      },
      {
        street: 'Hai Bà Trưng',
        ward: 'Phường Đa Kao',
        district: 'Quận 1',
        lat: 10.7845,
        lng: 106.6958,
      },
      {
        street: 'Trần Hưng Đạo',
        ward: 'Phường Cầu Ông Lãnh',
        district: 'Quận 1',
        lat: 10.7668,
        lng: 106.6928,
      },
      {
        street: 'Võ Văn Tần',
        ward: 'Phường Võ Thị Sáu',
        district: 'Quận 3',
        lat: 10.7765,
        lng: 106.6885,
      },
      {
        street: 'Nguyễn Đình Chiểu',
        ward: 'Phường 5',
        district: 'Quận 3',
        lat: 10.7738,
        lng: 106.6848,
      },
      {
        street: 'Nam Kỳ Khởi Nghĩa',
        ward: 'Phường Võ Thị Sáu',
        district: 'Quận 3',
        lat: 10.7825,
        lng: 106.6898,
      },
      {
        street: 'Pasteur',
        ward: 'Phường Bến Nghé',
        district: 'Quận 1',
        lat: 10.7782,
        lng: 106.6978,
      },
    ],
  },
  {
    id: 'zone0000-0000-0000-0000-000000000004',
    name: 'Zone 04 - TP. Thủ Đức',
    polygon: [
      [106.7365, 10.828],
      [106.765, 10.8265],
      [106.7855, 10.841],
      [106.784, 10.8685],
      [106.754, 10.8695],
      [106.7365, 10.854],
      [106.7365, 10.828],
    ],
    streets: [
      {
        street: 'Võ Văn Ngân',
        ward: 'Phường Linh Chiểu',
        district: 'TP. Thủ Đức',
        lat: 10.8508,
        lng: 106.7635,
      },
      {
        street: 'Kha Vạn Cân',
        ward: 'Phường Linh Đông',
        district: 'TP. Thủ Đức',
        lat: 10.8442,
        lng: 106.7525,
      },
      {
        street: 'Đặng Văn Bi',
        ward: 'Phường Trường Thọ',
        district: 'TP. Thủ Đức',
        lat: 10.8415,
        lng: 106.7648,
      },
      {
        street: 'Hoàng Diệu 2',
        ward: 'Phường Linh Trung',
        district: 'TP. Thủ Đức',
        lat: 10.8568,
        lng: 106.7685,
      },
      {
        street: 'Phạm Văn Đồng',
        ward: 'Phường Hiệp Bình Chánh',
        district: 'TP. Thủ Đức',
        lat: 10.8355,
        lng: 106.7438,
      },
      {
        street: 'Lê Văn Việt',
        ward: 'Phường Hiệp Phú',
        district: 'TP. Thủ Đức',
        lat: 10.8465,
        lng: 106.7782,
      },
      {
        street: 'Tô Ngọc Vân',
        ward: 'Phường Tam Phú',
        district: 'TP. Thủ Đức',
        lat: 10.8615,
        lng: 106.7518,
      },
    ],
  },
  {
    id: 'zone0000-0000-0000-0000-000000000005',
    name: 'Zone 05 - Quận Tân Bình',
    polygon: [
      [106.633, 10.788],
      [106.656, 10.7865],
      [106.6675, 10.794],
      [106.667, 10.8145],
      [106.645, 10.815],
      [106.633, 10.805],
      [106.633, 10.788],
    ],
    streets: [
      {
        street: 'Cộng Hòa',
        ward: 'Phường 13',
        district: 'Quận Tân Bình',
        lat: 10.8018,
        lng: 106.6518,
      },
      {
        street: 'Trường Chinh',
        ward: 'Phường 14',
        district: 'Quận Tân Bình',
        lat: 10.7995,
        lng: 106.6415,
      },
      {
        street: 'Hoàng Văn Thụ',
        ward: 'Phường 4',
        district: 'Quận Tân Bình',
        lat: 10.7985,
        lng: 106.6608,
      },
      {
        street: 'Út Tịch',
        ward: 'Phường 4',
        district: 'Quận Tân Bình',
        lat: 10.7948,
        lng: 106.6585,
      },
      {
        street: 'Lạc Long Quân',
        ward: 'Phường 10',
        district: 'Quận Tân Bình',
        lat: 10.7898,
        lng: 106.6488,
      },
      {
        street: 'Phổ Quang',
        ward: 'Phường 2',
        district: 'Quận Tân Bình',
        lat: 10.8085,
        lng: 106.6648,
      },
      {
        street: 'Bạch Đằng Tân Sơn',
        ward: 'Phường 2',
        district: 'Quận Tân Bình',
        lat: 10.8122,
        lng: 106.6625,
      },
    ],
  },
  {
    id: 'zone0000-0000-0000-0000-000000000006',
    name: 'Zone 06 - Quận Phú Nhuận',
    polygon: [
      [106.6715, 10.792],
      [106.686, 10.791],
      [106.692, 10.7985],
      [106.6915, 10.8135],
      [106.676, 10.814],
      [106.6715, 10.804],
      [106.6715, 10.792],
    ],
    streets: [
      {
        street: 'Phan Xích Long',
        ward: 'Phường 2',
        district: 'Quận Phú Nhuận',
        lat: 10.7985,
        lng: 106.6882,
      },
      {
        street: 'Nguyễn Văn Trỗi',
        ward: 'Phường 8',
        district: 'Quận Phú Nhuận',
        lat: 10.7975,
        lng: 106.6768,
      },
      {
        street: 'Phan Đăng Lưu',
        ward: 'Phường 3',
        district: 'Quận Phú Nhuận',
        lat: 10.8038,
        lng: 106.6852,
      },
      {
        street: 'Huỳnh Văn Bánh',
        ward: 'Phường 11',
        district: 'Quận Phú Nhuận',
        lat: 10.7938,
        lng: 106.6788,
      },
      {
        street: 'Nguyễn Kiệm',
        ward: 'Phường 9',
        district: 'Quận Phú Nhuận',
        lat: 10.8098,
        lng: 106.6795,
      },
      {
        street: 'Lê Văn Sỹ',
        ward: 'Phường 13',
        district: 'Quận Phú Nhuận',
        lat: 10.7928,
        lng: 106.6748,
      },
    ],
  },
];

// 29 Users: 1 Admin + 3 Dispatchers + 25 Drivers (5 per Hub, strict Single-Zone Exclusivity)
interface StaffSeed {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'ADMIN' | 'DISPATCHER';
}

const STAFF_USERS: StaffSeed[] = [
  {
    id: 'u0000000-0000-0000-0000-000000000001',
    fullName: 'Trần Minh Quân',
    email: 'admin@smartexpress.vn',
    phone: '0901000001',
    role: 'ADMIN',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000002',
    fullName: 'Lê Hoàng Nam',
    email: 'dispatcher1@smartexpress.vn',
    phone: '0901000002',
    role: 'DISPATCHER',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000003',
    fullName: 'Nguyễn Thị Minh Thư',
    email: 'dispatcher2@smartexpress.vn',
    phone: '0901000003',
    role: 'DISPATCHER',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000004',
    fullName: 'Phạm Quốc Bảo',
    email: 'dispatcher3@smartexpress.vn',
    phone: '0901000004',
    role: 'DISPATCHER',
  },
];

interface DriverSeed {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  depotIdx: number;
  zoneIdx: number;
  plate: string;
  vehicleType: 'MOTORBIKE' | 'VAN_500KG' | 'TRUCK_1TON';
  maxWeightKg: number;
  maxVolumeM3: number;
  shiftStatus: 'ONLINE_READY' | 'BUSY' | 'OFFLINE';
}

const DRIVERS: DriverSeed[] = [
  // Hub 01 - Gò Vấp (5 drivers -> Zone 01; driver01 is BUSY on live Mobile Demo route; driver02..05 = 1,620kg ONLINE_READY for VRP!)
  {
    id: 'u0000000-0000-0000-0000-000000000101',
    fullName: 'Ngô Văn Tài',
    email: 'driver01@smartexpress.vn',
    phone: '0902100101',
    depotIdx: 0,
    zoneIdx: 0,
    plate: '59G1-889.01',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.3,
    shiftStatus: 'BUSY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000102',
    fullName: 'Đặng Quốc Huy',
    email: 'driver02@smartexpress.vn',
    phone: '0902100102',
    depotIdx: 0,
    zoneIdx: 0,
    plate: '59G2-412.68',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.32,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000103',
    fullName: 'Võ Thanh Tùng',
    email: 'driver03@smartexpress.vn',
    phone: '0902100103',
    depotIdx: 0,
    zoneIdx: 0,
    plate: '59G1-735.19',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.35,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000104',
    fullName: 'Huỳnh Tấn Phát',
    email: 'driver04@smartexpress.vn',
    phone: '0902100104',
    depotIdx: 0,
    zoneIdx: 0,
    plate: '51D-618.42',
    vehicleType: 'VAN_500KG',
    maxWeightKg: 500,
    maxVolumeM3: 2.5,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000105',
    fullName: 'Bùi Hoàng Khang',
    email: 'driver05@smartexpress.vn',
    phone: '0902100105',
    depotIdx: 0,
    zoneIdx: 0,
    plate: '51C-904.75',
    vehicleType: 'TRUCK_1TON',
    maxWeightKg: 1000,
    maxVolumeM3: 5.0,
    shiftStatus: 'ONLINE_READY',
  },

  // Hub 02 - Bình Thạnh (5 drivers -> Zone 02)
  {
    id: 'u0000000-0000-0000-0000-000000000106',
    fullName: 'Phan Minh Đức',
    email: 'driver06@smartexpress.vn',
    phone: '0902100106',
    depotIdx: 1,
    zoneIdx: 1,
    plate: '59S2-309.54',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.28,
    shiftStatus: 'BUSY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000107',
    fullName: 'Trương Quốc Việt',
    email: 'driver07@smartexpress.vn',
    phone: '0902100107',
    depotIdx: 1,
    zoneIdx: 1,
    plate: '59S1-664.21',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.3,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000108',
    fullName: 'Lý Gia Bảo',
    email: 'driver08@smartexpress.vn',
    phone: '0902100108',
    depotIdx: 1,
    zoneIdx: 1,
    plate: '59S3-128.90',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 50,
    maxVolumeM3: 0.25,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000109',
    fullName: 'Đỗ Thành Đạt',
    email: 'driver09@smartexpress.vn',
    phone: '0902100109',
    depotIdx: 1,
    zoneIdx: 1,
    plate: '51D-447.83',
    vehicleType: 'VAN_500KG',
    maxWeightKg: 500,
    maxVolumeM3: 2.5,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000110',
    fullName: 'Hồ Trọng Nghĩa',
    email: 'driver10@smartexpress.vn',
    phone: '0902100110',
    depotIdx: 1,
    zoneIdx: 1,
    plate: '51C-782.16',
    vehicleType: 'TRUCK_1TON',
    maxWeightKg: 1000,
    maxVolumeM3: 5.0,
    shiftStatus: 'ONLINE_READY',
  },

  // Hub 03 - Quận 1 Bến Thành (5 drivers -> 4 in Zone 03, 1 in Zone 06 Phú Nhuận)
  {
    id: 'u0000000-0000-0000-0000-000000000111',
    fullName: 'Nguyễn Hữu Phước',
    email: 'driver11@smartexpress.vn',
    phone: '0902100111',
    depotIdx: 2,
    zoneIdx: 2,
    plate: '59T1-512.37',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.3,
    shiftStatus: 'BUSY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000112',
    fullName: 'Lâm Quang Vinh',
    email: 'driver12@smartexpress.vn',
    phone: '0902100112',
    depotIdx: 2,
    zoneIdx: 2,
    plate: '59T2-843.65',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.32,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000113',
    fullName: 'Đinh Tuấn Kiệt',
    email: 'driver13@smartexpress.vn',
    phone: '0902100113',
    depotIdx: 2,
    zoneIdx: 2,
    plate: '51D-359.24',
    vehicleType: 'VAN_500KG',
    maxWeightKg: 500,
    maxVolumeM3: 2.5,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000114',
    fullName: 'Mai Xuân Trường',
    email: 'driver14@smartexpress.vn',
    phone: '0902100114',
    depotIdx: 2,
    zoneIdx: 2,
    plate: '51C-615.49',
    vehicleType: 'TRUCK_1TON',
    maxWeightKg: 1000,
    maxVolumeM3: 5.0,
    shiftStatus: 'OFFLINE',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000115',
    fullName: 'Trịnh Công Minh',
    email: 'driver15@smartexpress.vn',
    phone: '0902100115',
    depotIdx: 2,
    zoneIdx: 5,
    plate: '59E1-294.71',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.28,
    shiftStatus: 'ONLINE_READY',
  },

  // Hub 04 - Thủ Đức Linh Chiểu (5 drivers -> Zone 04)
  {
    id: 'u0000000-0000-0000-0000-000000000116',
    fullName: 'Dương Nhật Hào',
    email: 'driver16@smartexpress.vn',
    phone: '0902100116',
    depotIdx: 3,
    zoneIdx: 3,
    plate: '59X3-771.08',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.32,
    shiftStatus: 'BUSY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000117',
    fullName: 'Lương Thế Vinh',
    email: 'driver17@smartexpress.vn',
    phone: '0902100117',
    depotIdx: 3,
    zoneIdx: 3,
    plate: '59X1-406.52',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.28,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000118',
    fullName: 'Vương Đình Khôi',
    email: 'driver18@smartexpress.vn',
    phone: '0902100118',
    depotIdx: 3,
    zoneIdx: 3,
    plate: '59X2-953.14',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 50,
    maxVolumeM3: 0.25,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000119',
    fullName: 'Tạ Minh Hoàng',
    email: 'driver19@smartexpress.vn',
    phone: '0902100119',
    depotIdx: 3,
    zoneIdx: 3,
    plate: '51D-826.37',
    vehicleType: 'VAN_500KG',
    maxWeightKg: 500,
    maxVolumeM3: 2.5,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000120',
    fullName: 'Châu Thái Sơn',
    email: 'driver20@smartexpress.vn',
    phone: '0902100120',
    depotIdx: 3,
    zoneIdx: 3,
    plate: '51C-539.88',
    vehicleType: 'TRUCK_1TON',
    maxWeightKg: 1000,
    maxVolumeM3: 5.0,
    shiftStatus: 'ONLINE_READY',
  },

  // Hub 05 - Tân Bình Cộng Hòa (5 drivers -> 4 in Zone 05, 1 in Zone 06 Phú Nhuận)
  {
    id: 'u0000000-0000-0000-0000-000000000121',
    fullName: 'Hà Quốc Cường',
    email: 'driver21@smartexpress.vn',
    phone: '0902100121',
    depotIdx: 4,
    zoneIdx: 4,
    plate: '59P1-628.43',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.3,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000122',
    fullName: 'Đoàn Văn Hậu',
    email: 'driver22@smartexpress.vn',
    phone: '0902100122',
    depotIdx: 4,
    zoneIdx: 4,
    plate: '59P2-187.96',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.28,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000123',
    fullName: 'Kiều Minh Tuấn',
    email: 'driver23@smartexpress.vn',
    phone: '0902100123',
    depotIdx: 4,
    zoneIdx: 4,
    plate: '51D-714.60',
    vehicleType: 'VAN_500KG',
    maxWeightKg: 500,
    maxVolumeM3: 2.5,
    shiftStatus: 'ONLINE_READY',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000124',
    fullName: 'Cao Bá Hưng',
    email: 'driver24@smartexpress.vn',
    phone: '0902100124',
    depotIdx: 4,
    zoneIdx: 4,
    plate: '51C-248.91',
    vehicleType: 'TRUCK_1TON',
    maxWeightKg: 1000,
    maxVolumeM3: 5.0,
    shiftStatus: 'OFFLINE',
  },
  {
    id: 'u0000000-0000-0000-0000-000000000125',
    fullName: 'Chu Thanh Phong',
    email: 'driver25@smartexpress.vn',
    phone: '0902100125',
    depotIdx: 4,
    zoneIdx: 5,
    plate: '59E2-504.32',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 55,
    maxVolumeM3: 0.3,
    shiftStatus: 'ONLINE_READY',
  },
];

// Curated VIP Repeat Customers (for Tab 4 Top Customers rankings!) + General Receivers
interface CustomerProfile {
  name: string;
  phone: string;
  preferredZoneIdx: number;
}

const VIP_CUSTOMERS: CustomerProfile[] = [
  { name: 'Nguyễn Thị Lan Anh - Shop Mỹ Phẩm Hasaki GV', phone: '0908112233', preferredZoneIdx: 0 },
  { name: 'Trần Quốc Tuấn - Điện Máy Minh Tuấn', phone: '0909223344', preferredZoneIdx: 1 },
  { name: 'Lê Ngọc Bích - Thời Trang Gumac Lê Lợi', phone: '0912334455', preferredZoneIdx: 2 },
  {
    name: 'Phạm Hoàng Long - Phụ Kiện Công Nghệ CellphoneS TĐ',
    phone: '0918445566',
    preferredZoneIdx: 3,
  },
  {
    name: 'Võ Thị Thu Trang - Siêu Thị Mẹ & Bé Con Cưng TB',
    phone: '0932556677',
    preferredZoneIdx: 4,
  },
  {
    name: 'Đặng Minh Khôi - Nhà Thuốc Pharmacity Phú Nhuận',
    phone: '0938667788',
    preferredZoneIdx: 5,
  },
  {
    name: 'Hoàng Thanh Thảo - Tiệm Bánh Artisan Quang Trung',
    phone: '0945778899',
    preferredZoneIdx: 0,
  },
  { name: 'Bùi Anh Dũng - Văn Phòng Luật Đại Việt Q1', phone: '0963889900', preferredZoneIdx: 2 },
  {
    name: 'Ngô Bảo Châu - Showroom Nội Thất Baya Bình Thạnh',
    phone: '0974990011',
    preferredZoneIdx: 1,
  },
  { name: 'Đỗ Gia Huy - Kho Sách Fahasa Thủ Đức', phone: '0986101122', preferredZoneIdx: 3 },
  {
    name: 'Lý Thanh Tâm - Cửa Hàng Thể Thao Decathlon Cộng Hòa',
    phone: '0903212233',
    preferredZoneIdx: 4,
  },
  {
    name: 'Phan Thảo Vy - Studio Áo Cưới Phan Xích Long',
    phone: '0914323344',
    preferredZoneIdx: 5,
  },
];

const REGULAR_SURNAMES = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Huỳnh',
  'Phan',
  'Vũ',
  'Võ',
  'Đặng',
  'Bùi',
  'Đỗ',
];
const REGULAR_MIDDLES = [
  'Văn',
  'Thị',
  'Minh',
  'Hoàng',
  'Ngọc',
  'Thanh',
  'Quốc',
  'Gia',
  'Tuấn',
  'Thu',
  'Hữu',
  'Phương',
];
const REGULAR_GIVENS = [
  'An',
  'Bình',
  'Châu',
  'Dũng',
  'Giang',
  'Hải',
  'Khánh',
  'Linh',
  'My',
  'Nam',
  'Oanh',
  'Phúc',
  'Quân',
  'Sơn',
  'Thảo',
  'Uyên',
  'Vy',
  'Yến',
];

const REGULAR_CUSTOMERS: CustomerProfile[] = Array.from({ length: 120 }, (_, idx) => ({
  name: `${REGULAR_SURNAMES[idx % REGULAR_SURNAMES.length]} ${REGULAR_MIDDLES[(idx * 3) % REGULAR_MIDDLES.length]} ${REGULAR_GIVENS[(idx * 7) % REGULAR_GIVENS.length]}`,
  phone: `097${String(5100000 + idx * 37).padStart(7, '0')}`,
  preferredZoneIdx: idx % ZONES.length,
}));

const SENDER_SHOPS = [
  { name: 'Kho Shopee Express Nam Sài Gòn', phone: '02873001100' },
  { name: 'Trung Tâm Hoàn Tất Đơn Hàng TikiNow HCM', phone: '02873002200' },
  { name: 'Lazada Logistics Hub Tân Bình', phone: '02873003300' },
  { name: 'TikTok Shop Fulfillment Gò Vấp', phone: '02873004400' },
  { name: ' Thế Giới Di Động - Kho Tổng Thủ Đức', phone: '02873005500' },
  { name: 'Bách Hóa Xanh Online - Trạm Bình Thạnh', phone: '02873006600' },
];

const FAILURE_REASONS = [
  'Khách không nghe máy sau 3 cuộc gọi liên tiếp',
  'Khách từ chối nhận hàng khi đồng kiểm mẫu mã',
  'Địa chỉ hẻm đang rào chắn thi công, khách hẹn gửi lại kho',
  'Người nhận đi công tác đột xuất không có người nhận thay',
  'Sai số điện thoại người nhận trên phiếu gửi hàng',
];

const DELIVERY_NOTES = [
  'Giao giờ hành chính, gọi trước 10 phút',
  'Hàng dễ vỡ - Xin nhẹ tay khi bốc xếp',
  'Gửi lễ tân tầng trệt nếu khách đang họp',
  'Cho phép đồng kiểm ngoại quan kiện hàng',
  'Giao tại cửa chính mặt tiền đường lớn',
  null,
];

function computeRealisticFee(weightKg: number): number {
  if (weightKg <= 5) return pick([25000, 30000, 35000]);
  if (weightKg <= 15) return pick([40000, 45000, 50000, 55000]);
  if (weightKg <= 35) return pick([75000, 85000, 95000, 110000]);
  return pick([125000, 140000, 155000, 170000, 180000]);
}

function computeRealisticCod(): number {
  const r = rng();
  if (r < 0.24) return 0; // Prepaid order
  if (r < 0.65) return randInt(15, 85) * 10000; // 150k - 850k
  if (r < 0.9) return randInt(90, 210) * 10000; // 900k - 2.1M
  return randInt(220, 350) * 10000; // 2.2M - 3.5M
}

function generateAddressInZone(zoneIdx: number): {
  address: string;
  lat: number;
  lng: number;
} {
  const zone = ZONES[zoneIdx];
  const s = pick(zone.streets);
  const houseNo = randInt(12, 680);
  // Keep jitter small (~180m) so coordinates stay strictly inside the zone's non-overlapping polygon
  const lat = Number((s.lat + randFloat(-0.0016, 0.0016, 6)).toFixed(7));
  const lng = Number((s.lng + randFloat(-0.0016, 0.0016, 6)).toFixed(7));
  return {
    address: `${houseNo} ${s.street}, ${s.ward}, ${s.district}, TP. Hồ Chí Minh`,
    lat,
    lng,
  };
}

// ─── Main Seeder Execution ────────────────────────────────────────────────────

async function runFullProductionSeeder(): Promise<void> {
  const startedAt = Date.now();
  console.log('======================================================================');
  console.log('🚀 SMART EXPRESS — FULL 14-TABLE PRODUCTION SEEDER (HCMC 90D + LIVE)');
  console.log('======================================================================');

  await ensureLocalPodImages();
  console.log('✓ Generated crisp local POD proof images in uploads/pod/*.jpg');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'delivery_db',
    charset: 'utf8mb4',
  });

  try {
    const [existingTableRows] = await conn.query<RowDataPacket[]>('SHOW TABLES');
    const existingTables = new Set<string>(
      existingTableRows.map((row) => String(Object.values(row)[0])),
    );

    // ── 0. Cleanly Reset All Tables (Respecting FK Constraints) ──────────────
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const tablesToReset = [
      'tracking_logs',
      'proof_of_deliveries',
      'stops',
      'routes',
      'order_status_histories',
      'orders',
      'shifts',
      'zone_drivers',
      'zones',
      'drivers',
      'password_resets',
      'notifications',
      'reports',
      'users',
      'depots',
      'regions',
    ];
    for (const tbl of tablesToReset) {
      if (existingTables.has(tbl)) {
        await conn.query(`TRUNCATE TABLE \`${tbl}\``);
      }
    }
    console.log('✓ Truncated all existing demo records cleanly');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 92 * 24 * 3600 * 1000);
    const createdEarlyStr = formatSqlDateTime(ninetyDaysAgo);
    const nowStr = formatSqlDateTime(now);

    // ── 1. Seed Regions (1 row) ──────────────────────────────────────────────
    await batchInsert(
      conn,
      'regions',
      ['id', 'code', 'name', 'description', 'created_at', 'updated_at'],
      [
        [
          REGION_HCM.id,
          REGION_HCM.code,
          REGION_HCM.name,
          REGION_HCM.description,
          createdEarlyStr,
          nowStr,
        ],
      ],
    );

    // ── 2. Seed Depots (5 HCMC Hubs) ─────────────────────────────────────────
    await batchInsert(
      conn,
      'depots',
      ['id', 'region_id', 'name', 'address', 'latitude', 'longitude', 'capacity', 'contact_phone'],
      DEPOTS.map((d) => [
        d.id,
        REGION_HCM.id,
        d.name,
        d.address,
        d.lat,
        d.lng,
        d.capacity,
        d.phone,
      ]),
    );

    // ── 3 & 4. Seed Users (29 total) & Drivers (25 total) ────────────────────
    const passwordHash = await bcrypt.hash('123456', 10);

    const userRows: SqlPrimitive[][] = [];
    for (const s of STAFF_USERS) {
      userRows.push([
        s.id,
        s.fullName,
        s.email,
        s.phone,
        passwordHash,
        s.role,
        'ACTIVE',
        createdEarlyStr,
        nowStr,
      ]);
    }
    for (const d of DRIVERS) {
      userRows.push([
        d.id,
        d.fullName,
        d.email,
        d.phone,
        passwordHash,
        'DRIVER',
        'ACTIVE',
        createdEarlyStr,
        nowStr,
      ]);
    }
    await batchInsert(
      conn,
      'users',
      [
        'id',
        'full_name',
        'email',
        'phone',
        'password_hash',
        'role',
        'status',
        'created_at',
        'updated_at',
      ],
      userRows,
    );

    await batchInsert(
      conn,
      'drivers',
      [
        'user_id',
        'depot_id',
        'license_plate',
        'vehicle_type',
        'max_weight_kg',
        'max_volume_m3',
        'current_shift_status',
      ],
      DRIVERS.map((d) => [
        d.id,
        DEPOTS[d.depotIdx].id,
        d.plate,
        d.vehicleType,
        d.maxWeightKg,
        d.maxVolumeM3,
        d.shiftStatus,
      ]),
    );

    // ── 5 & 6. Seed Zones (6 Polygons) & ZoneDrivers (25 strict 1:1 rows) ────
    await batchInsert(
      conn,
      'zones',
      ['id', 'name', 'boundary_geojson', 'created_at'],
      ZONES.map((z) => [
        z.id,
        z.name,
        JSON.stringify({ type: 'Polygon', coordinates: [z.polygon] }),
        createdEarlyStr,
      ]),
    );

    await batchInsert(
      conn,
      'zone_drivers',
      ['zone_id', 'driver_id', 'assigned_at'],
      DRIVERS.map((d) => [ZONES[d.zoneIdx].id, d.id, createdEarlyStr]),
    );

    // ── Accumulators for Operational Tables (7..13) ──────────────────────────
    const orderRows: SqlPrimitive[][] = [];
    const historyRows: SqlPrimitive[][] = [];
    const shiftRows: SqlPrimitive[][] = [];
    const routeRows: SqlPrimitive[][] = [];
    const stopRows: SqlPrimitive[][] = [];
    const podRows: SqlPrimitive[][] = [];
    const trackingRows: SqlPrimitive[][] = [];

    let orderSeq = 1;
    let historySeq = 1;
    let shiftSeq = 1;
    let routeSeq = 1;
    let stopSeq = 1;
    let podSeq = 1;
    let trackingSeq = 1;

    const dispatchers = STAFF_USERS.filter((s) => s.role === 'DISPATCHER');

    // ── 7A. Historical 90-Day Orders, Shifts, Routes, Stops & PODs ───────────
    // Calibrated so BOTH chronological volume AND weekday buckets (T2->T7->CN) produce:
    //  • OLS Linear Regression: positive slope & trend = 'UP' across 7d, 30d, and 90d!
    //  • Z-Score Peak Day: Saturday ('T7' Flash Sale / Weekend Delivery Peak) zScore >= 2.1 (isAbnormal = true)!
    //  • Plus calendar Double-Day campaign surges (09/09, 10/10, 11/11).
    const weekdayBaseVolume: Record<number, number> = {
      1: 5, // Mon (T2)
      2: 6, // Tue (T3)
      3: 6, // Wed (T4)
      4: 7, // Thu (T5)
      5: 8, // Fri (T6)
      6: 16, // Sat (T7 — Intentional Peak Day for Z-Score >= 2.0 & OLS UP trend!)
      0: 8, // Sun (CN)
    };

    // Group drivers by depot for realistic historical route assignment
    const driversByDepot = DEPOTS.map((_, dIdx) => DRIVERS.filter((dr) => dr.depotIdx === dIdx));

    for (let daysAgo = 90; daysAgo >= 1; daysAgo--) {
      const dayDate = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000);
      dayDate.setHours(8, 0, 0, 0);

      const dow = dayDate.getDay(); // 0=Sun..6=Sat
      const baseCount = weekdayBaseVolume[dow] ?? 6;
      // Progressive 90-day growth multiplier: ~0.78x at Day -90 -> ~1.28x at Day -1
      const growthFactor = 0.78 + ((90 - daysAgo) / 90) * 0.5;

      // Extra Double-Day e-commerce campaign multiplier (e.g. 9/9, 10/10, 11/11)
      const isDoubleDay =
        dayDate.getDate() === dayDate.getMonth() + 1 &&
        dayDate.getDate() >= 1 &&
        dayDate.getDate() <= 12;
      const campaignBoost = isDoubleDay ? 1.65 : 1.0;

      const dailyTotal = Math.max(4, Math.round(baseCount * growthFactor * campaignBoost));
      const dateStr = formatSqlDate(dayDate);
      const ymdCompact = dateStr.replace(/-/g, '').slice(2);

      // Partition daily orders into: ~82% DELIVERED, ~8% FAILED, ~10% NEW/ASSIGNED/IN_TRANSIT (for recent days) or DELIVERED
      interface GeneratedOrderMeta {
        id: string;
        code: string;
        depotIdx: number;
        zoneIdx: number;
        lat: number;
        lng: number;
        codAmount: number;
        deliveryFee: number;
        status: 'DELIVERED' | 'FAILED' | 'NEW' | 'ASSIGNED' | 'IN_TRANSIT';
        createdAt: Date;
      }

      const routedOrdersToday: GeneratedOrderMeta[] = [];

      for (let k = 0; k < dailyTotal; k++) {
        const orderId = makeUuid('0fde0000', orderSeq);
        const orderCode = `SE-${ymdCompact}-${String(orderSeq).padStart(4, '0')}`;
        orderSeq++;

        // 38% chance VIP customer so Top Customers leaderboard has strong repeat volume
        const customer = rng() < 0.38 ? pick(VIP_CUSTOMERS) : pick(REGULAR_CUSTOMERS);
        const zoneIdx = rng() < 0.75 ? customer.preferredZoneIdx : randInt(0, ZONES.length - 1);
        const depotIdx = zoneIdx === 5 ? (rng() < 0.5 ? 2 : 4) : zoneIdx;
        const loc = generateAddressInZone(zoneIdx);
        const sender = pick(SENDER_SHOPS);
        const dispatcher = pick(dispatchers);

        const isBulky = rng() < 0.25;
        const weightKg = isBulky ? randFloat(22, 65, 1) : randFloat(1.2, 14.5, 1);
        const volumeM3 = isBulky ? randFloat(0.08, 0.28, 3) : randFloat(0.008, 0.045, 3);
        const codAmount = computeRealisticCod();
        const deliveryFee = computeRealisticFee(weightKg);

        // Status distribution across the 90-day historical dataset: ~82% DELIVERED, ~8% FAILED, ~10% NEW/ASSIGNED/IN_TRANSIT
        const statusRoll = rng();
        let status: GeneratedOrderMeta['status'];
        if (statusRoll < 0.825) {
          status = 'DELIVERED';
        } else if (statusRoll < 0.908) {
          status = 'FAILED';
        } else if (daysAgo <= 14) {
          status = pick(['NEW', 'ASSIGNED', 'IN_TRANSIT'] as const);
        } else {
          // Older pipeline orders concentrated on non-hub-01 depots so Hub 01's VRP pool stays pure & calibrated
          status = depotIdx === 0 ? 'DELIVERED' : pick(['NEW', 'ASSIGNED', 'IN_TRANSIT'] as const);
        }

        // Never place historical 'NEW' orders on Hub 01 so Hub 01's live VRP pool is 100% controlled
        if (status === 'NEW' && depotIdx === 0) {
          status = 'ASSIGNED';
        }

        const createdAt = new Date(dayDate.getTime() + randInt(0, 210) * 60 * 1000);
        const createdStr = formatSqlDateTime(createdAt);
        const assignedDriver = status === 'NEW' ? null : pick(driversByDepot[depotIdx]);

        const updatedAt = new Date(createdAt.getTime() + randInt(90, 360) * 60 * 1000);

        orderRows.push([
          orderId,
          orderCode,
          DEPOTS[depotIdx].id,
          dispatcher.id,
          ZONES[zoneIdx].id,
          assignedDriver ? assignedDriver.id : null,
          customer.name,
          customer.phone,
          loc.address,
          loc.lat,
          loc.lng,
          weightKg,
          volumeM3,
          codAmount,
          status,
          sender.name,
          sender.phone.trim(),
          deliveryFee,
          pick(DELIVERY_NOTES),
          createdStr,
          formatSqlDateTime(updatedAt),
        ]);

        // Order lifecycle audit history
        historyRows.push([
          makeUuid('b1570000', historySeq++),
          orderId,
          'NEW',
          createdStr,
          `Đơn hàng tiếp nhận tại ${DEPOTS[depotIdx].name}`,
        ]);

        if (status !== 'NEW') {
          const tAssigned = new Date(createdAt.getTime() + 25 * 60 * 1000);
          historyRows.push([
            makeUuid('b1570000', historySeq++),
            orderId,
            'ASSIGNED',
            formatSqlDateTime(tAssigned),
            `Điều phối viên ${dispatcher.fullName} phân tuyến cho tài xế ${assignedDriver?.fullName ?? ''}`,
          ]);

          if (status === 'IN_TRANSIT' || status === 'DELIVERED' || status === 'FAILED') {
            const tTransit = new Date(createdAt.getTime() + 65 * 60 * 1000);
            historyRows.push([
              makeUuid('b1570000', historySeq++),
              orderId,
              'IN_TRANSIT',
              formatSqlDateTime(tTransit),
              'Tài xế đã xuất kho và đang trên đường giao hàng',
            ]);
          }
        }

        if (status === 'DELIVERED' || status === 'FAILED') {
          routedOrdersToday.push({
            id: orderId,
            code: orderCode,
            depotIdx,
            zoneIdx,
            lat: loc.lat,
            lng: loc.lng,
            codAmount,
            deliveryFee,
            status,
            createdAt,
          });
        }
      }

      // Group today's completed/failed orders by depot into realistic historical Shifts + Routes + Stops + PODs
      const byDepot = new Map<number, GeneratedOrderMeta[]>();
      for (const item of routedOrdersToday) {
        const list = byDepot.get(item.depotIdx) ?? [];
        list.push(item);
        byDepot.set(item.depotIdx, list);
      }

      for (const [depotIdx, depotOrders] of byDepot.entries()) {
        // Chunk by up to 8 stops per historical route
        const depotDrivers = driversByDepot[depotIdx];
        let chunkIdx = 0;
        for (let offset = 0; offset < depotOrders.length; offset += 8) {
          const slice = depotOrders.slice(offset, offset + 8);
          // Rotate drivers deterministically across days so every driver builds rich earnings history
          const driver = depotDrivers[(daysAgo + chunkIdx) % depotDrivers.length];
          chunkIdx++;

          const shiftId = makeUuid('5b1f0000', shiftSeq++);
          const routeId = makeUuid('f0070000', routeSeq++);
          const dispatcher = dispatchers[(daysAgo + depotIdx) % dispatchers.length];

          const shiftStart = new Date(dayDate.getTime() - 30 * 60 * 1000); // 07:30
          const routeStart = new Date(dayDate.getTime() + 15 * 60 * 1000); // 08:15
          const routeEnd = new Date(routeStart.getTime() + (slice.length * 22 + 35) * 60 * 1000);
          const shiftEnd = new Date(routeEnd.getTime() + 25 * 60 * 1000);

          let routeCodCollected = 0;
          const depot = DEPOTS[depotIdx];
          const polyCoords: [number, number][] = [[depot.lat, depot.lng]];
          let totalDistKm = 0;
          let prevLat = depot.lat;
          let prevLng = depot.lng;

          for (let sIdx = 0; sIdx < slice.length; sIdx++) {
            const ord = slice[sIdx];
            const stopId = makeUuid('57090000', stopSeq++);
            const arrivedTime = new Date(routeStart.getTime() + (sIdx + 1) * 21 * 60 * 1000);
            const confirmedTime = new Date(arrivedTime.getTime() + 4 * 60 * 1000);

            totalDistKm += haversineKm(prevLat, prevLng, ord.lat, ord.lng) * 1.32;
            prevLat = ord.lat;
            prevLng = ord.lng;
            polyCoords.push([ord.lat, ord.lng]);

            const isDelivered = ord.status === 'DELIVERED';
            const stopStatus = isDelivered ? 'COMPLETED' : 'FAILED';
            const collected = isDelivered ? ord.codAmount : 0;
            routeCodCollected += collected;

            stopRows.push([
              stopId,
              routeId,
              ord.id,
              sIdx + 1,
              formatSqlDateTime(arrivedTime),
              stopStatus,
            ]);

            const failReason = isDelivered ? null : pick(FAILURE_REASONS);
            const podPhoto = isDelivered
              ? `/uploads/pod/pod-sample-${(podSeq % 3) + 1}.jpg`
              : '/uploads/pod/pod-failed-1.jpg';

            podRows.push([
              makeUuid('90d00000', podSeq++),
              stopId,
              podPhoto,
              collected,
              failReason,
              null,
              formatSqlDateTime(confirmedTime),
            ]);

            historyRows.push([
              makeUuid('b1570000', historySeq++),
              ord.id,
              ord.status,
              formatSqlDateTime(confirmedTime),
              isDelivered
                ? `Giao thành công — Đã thu COD ${collected.toLocaleString('vi-VN')}đ`
                : `Giao thất bại: ${failReason ?? ''}`,
            ]);

            // Add 1 historical GPS breadcrumb on recent 7 days
            if (daysAgo <= 7 && sIdx % 3 === 0) {
              trackingRows.push([
                makeUuid('7fac0000', trackingSeq++),
                driver.id,
                shiftId,
                ord.lat,
                ord.lng,
                randInt(70, 96),
                formatSqlDateTime(arrivedTime),
                formatSqlDateTime(arrivedTime),
              ]);
            }
          }

          totalDistKm += haversineKm(prevLat, prevLng, depot.lat, depot.lng) * 1.32;
          polyCoords.push([depot.lat, depot.lng]);

          // Leave ~6 recent shifts in OPEN + unreconciled (reconciled_at = NULL) so Dispatcher can click "Đối soát COD" live on /reports!
          // (Note: MySQL chk_shift_status enforces status IN ('OPEN', 'CLOSED'), and ReportsService.reconcileShift requires status = 'OPEN' & reconciled_at IS NULL)
          const isPendingReconciliation = daysAgo <= 3 && shiftSeq % 3 === 0;
          let shiftStatus: 'CLOSED' | 'OPEN' = 'CLOSED';
          let codSubmitted = routeCodCollected;
          let reconciledBy: string | null = dispatcher.id;
          let reconciledAtStr: string | null = formatSqlDateTime(
            new Date(shiftEnd.getTime() + 40 * 60 * 1000),
          );

          if (isPendingReconciliation) {
            shiftStatus = 'OPEN';
            reconciledBy = null;
            reconciledAtStr = null;
            if (routeCodCollected >= 200000 && shiftSeq % 2 === 0) {
              codSubmitted = routeCodCollected - pick([20000, 50000]);
            }
          } else if (daysAgo <= 14 && routeCodCollected >= 300000 && shiftSeq % 9 === 0) {
            // Historical reconciled shift with recorded minor discrepancy for audit realism
            codSubmitted = routeCodCollected - 20000;
          }

          shiftRows.push([
            shiftId,
            driver.id,
            formatSqlDateTime(shiftStart),
            formatSqlDateTime(shiftEnd),
            shiftStatus,
            500000,
            depot.lat,
            depot.lng,
            routeCodCollected,
            codSubmitted,
            reconciledBy,
            reconciledAtStr,
            formatSqlDateTime(shiftStart),
            formatSqlDateTime(shiftEnd),
          ]);

          routeRows.push([
            routeId,
            depot.id,
            driver.id,
            shiftId,
            dispatcher.id,
            dateStr,
            Number(Math.max(4.5, totalDistKm).toFixed(2)),
            Math.max(35, Math.round(totalDistKm * 3.2 + slice.length * 8)),
            'COMPLETED',
            buildSmoothPolyline(polyCoords),
            formatSqlDateTime(routeStart),
            formatSqlDateTime(routeEnd),
            formatSqlDateTime(shiftStart),
            formatSqlDateTime(routeEnd),
          ]);
        }
      }
    }

    // ── 7B. LIVE TODAY — VRP Demo Pool at Hub 01 - Gò Vấp (90 NEW Orders) ────
    // Hub 01 ONLINE_READY fleet capacity (driver02..driver05):
    //   60kg (Motorbike) + 60kg (Motorbike) + 500kg (Van) + 1000kg (Truck) = 1,620.0 kg total!
    // We seed 90 NEW orders at Hub 01 (54 light 2–12.5kg = 60% + 36 bulky 25–47kg = 40%)
    // summing to 1,608.0 kg (99.26% of 1,620 kg capacity, staying below the 50-stop/vehicle cap)!
    const lightWeightsPool = [
      2.0, 2.5, 2.5, 3.0, 3.0, 3.5, 3.5, 4.0, 4.0, 4.0, 4.5, 4.5, 5.0, 5.0, 5.0, 5.5, 5.5, 5.5, 6.0,
      6.0, 6.0, 6.0, 6.5, 6.5, 6.5, 7.0, 7.0, 7.0, 7.0, 7.5, 7.5, 7.5, 8.0, 8.0, 8.0, 8.5, 8.5, 9.0,
      9.0, 9.5, 9.5, 10.0, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 3.0, 3.5, 4.0, 4.5, 2.0, 5.0,
    ]; // 54 light orders => Sum = 344.0 kg

    const bulkyWeightsPool = [
      25.0, 25.0, 26.0, 26.0, 27.0, 27.0, 28.0, 28.0, 29.0, 29.0, 30.0, 30.0, 31.0, 31.0, 32.0,
      32.0, 33.0, 34.0, 35.0, 35.0, 36.0, 37.0, 38.0, 39.0, 40.0, 40.0, 41.0, 42.0, 42.0, 43.0,
      44.0, 45.0, 45.0, 46.0, 46.0, 47.0,
    ]; // 36 bulky orders => Sum = 1,264.0 kg -> Total Pool = 1,608.0 kg / 1,620.0 kg = 99.26%!

    const vrpWeights = [...lightWeightsPool, ...bulkyWeightsPool];
    const todayCompact = formatSqlDate(now).replace(/-/g, '').slice(2);
    const goVapZone = ZONES[0];

    for (let i = 0; i < vrpWeights.length; i++) {
      const w = vrpWeights[i];
      const isBulky = w > 20;
      const vol = isBulky ? randFloat(0.065, 0.115, 3) : randFloat(0.01, 0.032, 3);
      const streetInfo = goVapZone.streets[i % goVapZone.streets.length];
      const houseNo = 15 + ((i * 17) % 480);
      const lat = Number((streetInfo.lat + ((i % 7) - 3) * 0.00048).toFixed(7));
      const lng = Number((streetInfo.lng + (((i * 3) % 7) - 3) * 0.00048).toFixed(7));
      const address = `${houseNo} ${streetInfo.street}, ${streetInfo.ward}, ${streetInfo.district}, TP. Hồ Chí Minh`;

      const customer =
        i % 5 === 0
          ? VIP_CUSTOMERS[i % VIP_CUSTOMERS.length]
          : REGULAR_CUSTOMERS[i % REGULAR_CUSTOMERS.length];
      const sender = SENDER_SHOPS[i % SENDER_SHOPS.length];
      const createdTime = new Date(now.getTime() - (160 - i) * 60 * 1000);
      const createdTimeStr = formatSqlDateTime(createdTime);

      const orderId = makeUuid('0fde0000', orderSeq);
      const orderCode = `SE-${todayCompact}-VRP${String(i + 1).padStart(3, '0')}`;
      orderSeq++;

      orderRows.push([
        orderId,
        orderCode,
        DEPOTS[0].id, // Hub 01 - Gò Vấp
        STAFF_USERS[1].id, // dispatcher1
        goVapZone.id, // Zone 01 - Quận Gò Vấp
        null, // Unassigned -> Ready for VRP!
        customer.name,
        customer.phone,
        address,
        lat,
        lng,
        w,
        vol,
        computeRealisticCod(),
        'NEW',
        sender.name,
        sender.phone.trim(),
        computeRealisticFee(w),
        isBulky
          ? 'Kiện hàng cồng kềnh — Ưu tiên xe tải / xe Van'
          : 'Giao trong ca hôm nay tại Gò Vấp',
        createdTimeStr,
        createdTimeStr,
      ]);

      historyRows.push([
        makeUuid('b1570000', historySeq++),
        orderId,
        'NEW',
        createdTimeStr,
        'Đơn hàng mới nhập kho Hub 01 - Gò Vấp, sẵn sàng tối ưu tuyến VRP',
      ]);
    }

    // ── 7C. LIVE TODAY — Mobile App Demo Driver (driver01@smartexpress.vn) ───
    // Active OPEN shift + Active IN_PROGRESS route with 14 stops in Gò Vấp:
    //   • Stops 1..5:  COMPLETED (DELIVERED + POD photo + real COD & delivery_fee -> Today's Earnings!)
    //   • Stop 6:      ARRIVED   (IN_TRANSIT -> Ready to test POD or Fail action right away!)
    //   • Stop 7:      SKIPPED   (RESCHEDULED -> Future rescheduled_date +4h -> Showcases Task Lock!)
    //   • Stops 8..14: PENDING   (ASSIGNED -> 7 upcoming stops with accurate Gò Vấp coordinates)
    const demoDriver = DRIVERS[0]; // driver01@smartexpress.vn (u0000000-0000-0000-0000-000000000101)
    const demoDepot = DEPOTS[0];
    const demoShiftId = 'shift000-live-0000-0000-000000000101';
    const demoRouteId = 'route000-live-0000-0000-000000000101';
    const demoShiftStart = new Date(now.getTime() - 155 * 60 * 1000);
    const demoRouteStart = new Date(now.getTime() - 140 * 60 * 1000);

    interface DemoStopSpec {
      receiverName: string;
      receiverPhone: string;
      address: string;
      lat: number;
      lng: number;
      weightKg: number;
      codAmount: number;
      deliveryFee: number;
      stopStatus: 'COMPLETED' | 'ARRIVED' | 'SKIPPED' | 'PENDING';
      orderStatus: 'DELIVERED' | 'IN_TRANSIT' | 'RESCHEDULED' | 'ASSIGNED';
      minsAgoArrived?: number;
    }

    const demoStopsSpec: DemoStopSpec[] = [
      // 5 COMPLETED stops
      {
        receiverName: 'Nguyễn Minh Tâm',
        receiverPhone: '0908311201',
        address: '112 Quang Trung, Phường 10, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8315,
        lng: 106.6698,
        weightKg: 3.2,
        codAmount: 450000,
        deliveryFee: 40000,
        stopStatus: 'COMPLETED',
        orderStatus: 'DELIVERED',
        minsAgoArrived: 122,
      },
      {
        receiverName: 'Trần Thảo Nguyên',
        receiverPhone: '0908311202',
        address: '368 Phan Văn Trị, Phường 5, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8268,
        lng: 106.6835,
        weightKg: 4.5,
        codAmount: 680000,
        deliveryFee: 45000,
        stopStatus: 'COMPLETED',
        orderStatus: 'DELIVERED',
        minsAgoArrived: 104,
      },
      {
        receiverName: 'Lê Hoàng Phúc',
        receiverPhone: '0908311203',
        address: '215 Nguyễn Văn Lượng, Phường 10, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8362,
        lng: 106.6745,
        weightKg: 5.0,
        codAmount: 0,
        deliveryFee: 50000,
        stopStatus: 'COMPLETED',
        orderStatus: 'DELIVERED',
        minsAgoArrived: 86,
      },
      {
        receiverName: 'Phạm Ngọc Hân',
        receiverPhone: '0908311204',
        address: '84 Lê Đức Thọ, Phường 15, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8435,
        lng: 106.6712,
        weightKg: 2.8,
        codAmount: 820000,
        deliveryFee: 35000,
        stopStatus: 'COMPLETED',
        orderStatus: 'DELIVERED',
        minsAgoArrived: 64,
      },
      {
        receiverName: 'Võ Quốc Khánh',
        receiverPhone: '0908311205',
        address: '195 Thống Nhất, Phường 11, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8395,
        lng: 106.6652,
        weightKg: 6.4,
        codAmount: 500000,
        deliveryFee: 60000,
        stopStatus: 'COMPLETED',
        orderStatus: 'DELIVERED',
        minsAgoArrived: 42,
      },
      // 1 ARRIVED stop (Current active stop #6)
      {
        receiverName: 'Đặng Thị Mai Phương',
        receiverPhone: '0908311206',
        address: '248 Quang Trung, Phường 10, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8368,
        lng: 106.6628,
        weightKg: 3.5,
        codAmount: 590000,
        deliveryFee: 45000,
        stopStatus: 'ARRIVED',
        orderStatus: 'IN_TRANSIT',
        minsAgoArrived: 6,
      },
      // 1 RESCHEDULED stop (Task-locked until +4 hours in the future!)
      {
        receiverName: 'Huỳnh Gia Hưng',
        receiverPhone: '0908311207',
        address: '412 Nguyễn Oanh, Phường 17, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8428,
        lng: 106.6768,
        weightKg: 4.0,
        codAmount: 1250000,
        deliveryFee: 50000,
        stopStatus: 'SKIPPED',
        orderStatus: 'RESCHEDULED',
        minsAgoArrived: 25,
      },
      // 7 PENDING stops
      {
        receiverName: 'Bùi Thanh Trúc',
        receiverPhone: '0908311208',
        address: '129 Lê Văn Thọ, Phường 9, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8432,
        lng: 106.6592,
        weightKg: 2.6,
        codAmount: 360000,
        deliveryFee: 35000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Đỗ Minh Quân',
        receiverPhone: '0908311209',
        address: '305 Phạm Văn Chiêu, Phường 14, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8478,
        lng: 106.6568,
        weightKg: 3.8,
        codAmount: 740000,
        deliveryFee: 40000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Ngô Thị Kiều Oanh',
        receiverPhone: '0908311210',
        address: '76 Nguyễn Văn Khối, Phường 8, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8396,
        lng: 106.6545,
        weightKg: 2.2,
        codAmount: 0,
        deliveryFee: 30000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Lý Tuấn Anh',
        receiverPhone: '0908311211',
        address: '188 Phan Huy Ích, Phường 12, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8362,
        lng: 106.6502,
        weightKg: 4.2,
        codAmount: 920000,
        deliveryFee: 45000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Phan Thanh Sơn',
        receiverPhone: '0908311212',
        address: '54 Dương Quảng Hàm, Phường 5, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8256,
        lng: 106.6848,
        weightKg: 3.0,
        codAmount: 410000,
        deliveryFee: 35000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Trịnh Ngọc Ánh',
        receiverPhone: '0908311213',
        address: '214 Nguyễn Thái Sơn, Phường 4, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8222,
        lng: 106.6812,
        weightKg: 3.6,
        codAmount: 650000,
        deliveryFee: 40000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
      {
        receiverName: 'Hồ Quốc Bảo',
        receiverPhone: '0908311214',
        address: '12 Nguyễn Văn Bảo, Phường 4, Quận Gò Vấp, TP. Hồ Chí Minh',
        lat: 10.8226,
        lng: 106.6872,
        weightKg: 2.9,
        codAmount: 280000,
        deliveryFee: 35000,
        stopStatus: 'PENDING',
        orderStatus: 'ASSIGNED',
      },
    ];

    let demoCodCollected = 0;
    const demoPolyCoords: [number, number][] = [[demoDepot.lat, demoDepot.lng]];
    const futureRescheduleStr = formatSqlDateTime(new Date(now.getTime() + 4 * 3600 * 1000)); // +4 hours in future!

    for (let idx = 0; idx < demoStopsSpec.length; idx++) {
      const sp = demoStopsSpec[idx];
      const orderId = makeUuid('0fde0000', orderSeq);
      const orderCode = `SE-${todayCompact}-DRV01-${String(idx + 1).padStart(2, '0')}`;
      orderSeq++;
      const stopId = makeUuid('57090000', stopSeq++);

      const orderCreated = new Date(demoShiftStart.getTime() - 25 * 60 * 1000);
      const arrivedDate = sp.minsAgoArrived
        ? new Date(now.getTime() - sp.minsAgoArrived * 60 * 1000)
        : null;
      const updatedDate = arrivedDate ?? demoRouteStart;

      demoPolyCoords.push([sp.lat, sp.lng]);

      orderRows.push([
        orderId,
        orderCode,
        demoDepot.id,
        STAFF_USERS[1].id,
        goVapZone.id,
        demoDriver.id,
        sp.receiverName,
        sp.receiverPhone,
        sp.address,
        sp.lat,
        sp.lng,
        sp.weightKg,
        0.02,
        sp.codAmount,
        sp.orderStatus,
        'TikTok Shop Fulfillment Gò Vấp',
        '02873004400',
        sp.deliveryFee,
        sp.orderStatus === 'RESCHEDULED'
          ? 'Khách hẹn giao lại sau 4 tiếng (đang họp tại văn phòng)'
          : 'Gọi điện trước khi đến điểm giao',
        formatSqlDateTime(orderCreated),
        formatSqlDateTime(updatedDate),
      ]);

      historyRows.push(
        [
          makeUuid('b1570000', historySeq++),
          orderId,
          'NEW',
          formatSqlDateTime(orderCreated),
          'Đơn hàng tiếp nhận tại Hub 01 - Gò Vấp',
        ],
        [
          makeUuid('b1570000', historySeq++),
          orderId,
          'ASSIGNED',
          formatSqlDateTime(demoRouteStart),
          `Điều phối cho tài xế ${demoDriver.fullName}`,
        ],
      );

      stopRows.push([
        stopId,
        demoRouteId,
        orderId,
        idx + 1,
        arrivedDate ? formatSqlDateTime(arrivedDate) : null,
        sp.stopStatus,
      ]);

      if (sp.stopStatus === 'COMPLETED' && arrivedDate) {
        demoCodCollected += sp.codAmount;
        const confirmedAt = new Date(arrivedDate.getTime() + 3 * 60 * 1000);
        podRows.push([
          makeUuid('90d00000', podSeq++),
          stopId,
          `/uploads/pod/pod-sample-${(idx % 3) + 1}.jpg`,
          sp.codAmount,
          null,
          null,
          formatSqlDateTime(confirmedAt),
        ]);
        historyRows.push(
          [
            makeUuid('b1570000', historySeq++),
            orderId,
            'IN_TRANSIT',
            formatSqlDateTime(arrivedDate),
            'Tài xế đã đến điểm giao hàng',
          ],
          [
            makeUuid('b1570000', historySeq++),
            orderId,
            'DELIVERED',
            formatSqlDateTime(confirmedAt),
            `Giao thành công — Thu hộ COD ${sp.codAmount.toLocaleString('vi-VN')}đ`,
          ],
        );
        trackingRows.push([
          makeUuid('7fac0000', trackingSeq++),
          demoDriver.id,
          demoShiftId,
          sp.lat,
          sp.lng,
          92 - idx,
          formatSqlDateTime(arrivedDate),
          formatSqlDateTime(arrivedDate),
        ]);
      } else if (sp.stopStatus === 'ARRIVED' && arrivedDate) {
        historyRows.push([
          makeUuid('b1570000', historySeq++),
          orderId,
          'IN_TRANSIT',
          formatSqlDateTime(arrivedDate),
          'Tài xế đã tới điểm dừng #6 (248 Quang Trung)',
        ]);
      } else if (sp.stopStatus === 'SKIPPED' && arrivedDate) {
        podRows.push([
          makeUuid('90d00000', podSeq++),
          stopId,
          null,
          0,
          'Khách đang họp tại văn phòng, hẹn giao lại sau 4 tiếng',
          futureRescheduleStr,
          formatSqlDateTime(arrivedDate),
        ]);
        historyRows.push([
          makeUuid('b1570000', historySeq++),
          orderId,
          'RESCHEDULED',
          formatSqlDateTime(arrivedDate),
          `Khách hẹn giao lại lúc ${futureRescheduleStr}`,
        ]);
      }
    }

    demoPolyCoords.push([demoDepot.lat, demoDepot.lng]);
    const currentStop6 = demoStopsSpec[5];

    shiftRows.push([
      demoShiftId,
      demoDriver.id,
      formatSqlDateTime(demoShiftStart),
      null,
      'OPEN',
      500000,
      currentStop6.lat,
      currentStop6.lng,
      demoCodCollected,
      0,
      null,
      null,
      formatSqlDateTime(demoShiftStart),
      nowStr,
    ]);

    routeRows.push([
      demoRouteId,
      demoDepot.id,
      demoDriver.id,
      demoShiftId,
      STAFF_USERS[1].id,
      formatSqlDate(now),
      19.4,
      148,
      'IN_PROGRESS',
      buildSmoothPolyline(demoPolyCoords),
      formatSqlDateTime(demoRouteStart),
      null,
      formatSqlDateTime(demoShiftStart),
      nowStr,
    ]);

    // ── 7D. 3 Additional Live IN_PROGRESS Routes Across HCMC (Bình Thạnh, Q1, Thủ Đức)
    // Makes /tracking Live Map look vibrant with 4 active multi-color routes across the city!
    const extraBusyDriverIndices = [5, 10, 15]; // driver06 (Hub 2), driver11 (Hub 3), driver16 (Hub 4)
    for (const dArrIdx of extraBusyDriverIndices) {
      const drv = DRIVERS[dArrIdx];
      const dep = DEPOTS[drv.depotIdx];
      const zn = ZONES[drv.zoneIdx];
      const liveShiftId = makeUuid('5b1f0000', shiftSeq++);
      const liveRouteId = makeUuid('f0070000', routeSeq++);
      const sStart = new Date(now.getTime() - 110 * 60 * 1000);
      const rStart = new Date(now.getTime() - 95 * 60 * 1000);

      let liveCod = 0;
      const liveCoords: [number, number][] = [[dep.lat, dep.lng]];
      let arrivedLat = dep.lat;
      let arrivedLng = dep.lng;

      for (let sNo = 1; sNo <= 6; sNo++) {
        const loc = generateAddressInZone(drv.zoneIdx);
        const cust = REGULAR_CUSTOMERS[(dArrIdx * 7 + sNo) % REGULAR_CUSTOMERS.length];
        const ordId = makeUuid('0fde0000', orderSeq);
        const ordCode = `SE-${todayCompact}-L${dArrIdx}-${sNo}`;
        orderSeq++;
        const stId = makeUuid('57090000', stopSeq++);
        const cod = sNo % 2 === 0 ? 480000 : 320000;
        const fee = 40000;

        let stStatus: 'COMPLETED' | 'ARRIVED' | 'PENDING' = 'PENDING';
        let ordStatus: 'DELIVERED' | 'IN_TRANSIT' | 'ASSIGNED' = 'ASSIGNED';
        let arrAt: Date | null = null;

        if (sNo <= 3) {
          stStatus = 'COMPLETED';
          ordStatus = 'DELIVERED';
          arrAt = new Date(now.getTime() - (85 - sNo * 20) * 60 * 1000);
          liveCod += cod;
        } else if (sNo === 4) {
          stStatus = 'ARRIVED';
          ordStatus = 'IN_TRANSIT';
          arrAt = new Date(now.getTime() - 5 * 60 * 1000);
          arrivedLat = loc.lat;
          arrivedLng = loc.lng;
        }

        liveCoords.push([loc.lat, loc.lng]);

        orderRows.push([
          ordId,
          ordCode,
          dep.id,
          STAFF_USERS[2].id,
          zn.id,
          drv.id,
          cust.name,
          cust.phone,
          loc.address,
          loc.lat,
          loc.lng,
          3.4,
          0.02,
          cod,
          ordStatus,
          SENDER_SHOPS[sNo % SENDER_SHOPS.length].name,
          SENDER_SHOPS[sNo % SENDER_SHOPS.length].phone,
          fee,
          'Đơn giao nhanh nội thành',
          formatSqlDateTime(sStart),
          arrAt ? formatSqlDateTime(arrAt) : formatSqlDateTime(rStart),
        ]);

        historyRows.push(
          [
            makeUuid('b1570000', historySeq++),
            ordId,
            'NEW',
            formatSqlDateTime(sStart),
            `Tiếp nhận tại ${dep.name}`,
          ],
          [
            makeUuid('b1570000', historySeq++),
            ordId,
            'ASSIGNED',
            formatSqlDateTime(rStart),
            `Phân công cho tài xế ${drv.fullName}`,
          ],
        );

        stopRows.push([
          stId,
          liveRouteId,
          ordId,
          sNo,
          arrAt ? formatSqlDateTime(arrAt) : null,
          stStatus,
        ]);

        if (stStatus === 'COMPLETED' && arrAt) {
          const conf = new Date(arrAt.getTime() + 3 * 60 * 1000);
          podRows.push([
            makeUuid('90d00000', podSeq++),
            stId,
            `/uploads/pod/pod-sample-${(sNo % 3) + 1}.jpg`,
            cod,
            null,
            null,
            formatSqlDateTime(conf),
          ]);
          historyRows.push([
            makeUuid('b1570000', historySeq++),
            ordId,
            'DELIVERED',
            formatSqlDateTime(conf),
            'Giao hàng thành công',
          ]);
        } else if (stStatus === 'ARRIVED' && arrAt) {
          historyRows.push([
            makeUuid('b1570000', historySeq++),
            ordId,
            'IN_TRANSIT',
            formatSqlDateTime(arrAt),
            'Tài xế đang giao tại điểm nhận',
          ]);
        }
      }

      liveCoords.push([dep.lat, dep.lng]);

      shiftRows.push([
        liveShiftId,
        drv.id,
        formatSqlDateTime(sStart),
        null,
        'OPEN',
        500000,
        arrivedLat,
        arrivedLng,
        liveCod,
        0,
        null,
        null,
        formatSqlDateTime(sStart),
        nowStr,
      ]);

      routeRows.push([
        liveRouteId,
        dep.id,
        drv.id,
        liveShiftId,
        STAFF_USERS[2].id,
        formatSqlDate(now),
        11.8,
        92,
        'IN_PROGRESS',
        buildSmoothPolyline(liveCoords),
        formatSqlDateTime(rStart),
        null,
        formatSqlDateTime(sStart),
        nowStr,
      ]);
    }

    // ── 7E. Active OPEN Shifts + Fresh GPS Logs (< 90s ago) for All 25 Drivers ──
    for (let i = 0; i < DRIVERS.length; i++) {
      const drv = DRIVERS[i];
      const dep = DEPOTS[drv.depotIdx];
      const zn = ZONES[drv.zoneIdx];
      const roadSample = zn.streets[i % zn.streets.length];

      let activeShiftIdForLog: string | null = null;
      let pingLat = Number((roadSample.lat + ((i % 5) - 2) * 0.0007).toFixed(7));
      let pingLng = Number((roadSample.lng + (((i * 2) % 5) - 2) * 0.0007).toFixed(7));

      if (i === 0) {
        activeShiftIdForLog = demoShiftId;
        pingLat = currentStop6.lat;
        pingLng = currentStop6.lng;
      } else if (drv.shiftStatus === 'ONLINE_READY') {
        const openShiftId = makeUuid('5b1f0000', shiftSeq++);
        const openStart = new Date(now.getTime() - randInt(45, 130) * 60 * 1000);
        activeShiftIdForLog = openShiftId;

        shiftRows.push([
          openShiftId,
          drv.id,
          formatSqlDateTime(openStart),
          null,
          'OPEN',
          500000,
          pingLat,
          pingLng,
          0,
          0,
          null,
          null,
          formatSqlDateTime(openStart),
          nowStr,
        ]);
      } else if (drv.shiftStatus === 'OFFLINE') {
        pingLat = Number((dep.lat + 0.0008).toFixed(7));
        pingLng = Number((dep.lng - 0.0006).toFixed(7));
      }

      const pingTime = new Date(now.getTime() - randInt(12, 85) * 1000); // Within the last ~1.5 minutes!
      const pingTimeStr = formatSqlDateTime(pingTime);

      trackingRows.push([
        makeUuid('7fac0000', trackingSeq++),
        drv.id,
        activeShiftIdForLog,
        pingLat,
        pingLng,
        randInt(66, 98),
        pingTimeStr,
        pingTimeStr,
      ]);
    }

    // ── Persist Operational Tables (7..13) in Dependency Order ───────────────
    await batchInsert(
      conn,
      'orders',
      [
        'id',
        'code',
        'depot_id',
        'dispatcher_id',
        'zone_id',
        'driver_id',
        'receiver_name',
        'receiver_phone',
        'delivery_address',
        'latitude',
        'longitude',
        'weight_kg',
        'volume_m3',
        'cod_amount',
        'status',
        'sender_name',
        'sender_phone',
        'delivery_fee',
        'notes',
        'created_at',
        'updated_at',
      ],
      orderRows,
    );

    await batchInsert(
      conn,
      'order_status_histories',
      ['id', 'order_id', 'status', 'timestamp', 'note'],
      historyRows,
    );

    await batchInsert(
      conn,
      'shifts',
      [
        'id',
        'driver_id',
        'start_time',
        'end_time',
        'status',
        'starting_cash_cod',
        'current_latitude',
        'current_longitude',
        'cod_collected',
        'cod_submitted',
        'reconciled_by',
        'reconciled_at',
        'created_at',
        'updated_at',
      ],
      shiftRows,
    );

    await batchInsert(
      conn,
      'routes',
      [
        'id',
        'depot_id',
        'driver_id',
        'shift_id',
        'dispatcher_id',
        'route_date',
        'total_distance_km',
        'total_estimated_time_min',
        'status',
        'polyline',
        'start_time',
        'end_time',
        'created_at',
        'updated_at',
      ],
      routeRows,
    );

    await batchInsert(
      conn,
      'stops',
      ['id', 'route_id', 'order_id', 'sequence_no', 'arrived_at', 'status'],
      stopRows,
    );

    await batchInsert(
      conn,
      'proof_of_deliveries',
      [
        'id',
        'stop_id',
        'photo_url',
        'cod_collected',
        'failure_reason',
        'rescheduled_date',
        'confirmed_at',
      ],
      podRows,
    );

    await batchInsert(
      conn,
      'tracking_logs',
      [
        'id',
        'driver_id',
        'shift_id',
        'latitude',
        'longitude',
        'battery_level',
        'timestamp',
        'created_at',
      ],
      trackingRows,
    );

    // ── 14. Seed password_resets (5 realistic historical audit rows) ─────────
    const resetEmails = [
      'driver03@smartexpress.vn',
      'driver12@smartexpress.vn',
      'dispatcher2@smartexpress.vn',
      'driver19@smartexpress.vn',
      'driver01@smartexpress.vn',
    ];
    const resetRows: SqlPrimitive[][] = resetEmails.map((email, idx) => {
      const created = new Date(now.getTime() - (idx + 2) * 5 * 24 * 3600 * 1000);
      const expires = new Date(created.getTime() + 10 * 60 * 1000);
      return [
        makeUuid('9a550000', idx + 1),
        email,
        sha256Hex(`otp-${idx}-654321`),
        sha256Hex(`reset-token-${email}-${idx}`),
        formatSqlDateTime(expires),
        idx < 4 ? 1 : 0,
        formatSqlDateTime(created),
      ];
    });
    await batchInsert(
      conn,
      'password_resets',
      ['id', 'email', 'otp_hash', 'token_hash', 'expires_at', 'is_used', 'created_at'],
      resetRows,
    );

    // ── Optional Auxiliary Tables (notifications & reports if present) ───────
    if (existingTables.has('notifications')) {
      const notifRows: SqlPrimitive[][] = [
        [
          makeUuid('a0710000', 1),
          STAFF_USERS[0].id,
          'Pool VRP Hub 01 - Gò Vấp sẵn sàng điều phối',
          'Hiện có 96 đơn hàng NEW (1.614 kg) tại Hub 01 - Gò Vấp đang chờ chạy thuật toán tối ưu tuyến VRP.',
          'info',
          0,
          nowStr,
        ],
        [
          makeUuid('a0710000', 2),
          STAFF_USERS[1].id,
          'Phát hiện chênh lệch đối soát COD cuối ca',
          'Có ca làm việc ở trạng thái Chờ đối soát (PENDING_SETTLEMENT) cần kiểm tra tiền mặt thực nộp.',
          'warning',
          0,
          nowStr,
        ],
        [
          makeUuid('a0710000', 3),
          STAFF_USERS[0].id,
          'Cảnh báo ngày cao điểm Z-Score (Thứ Bảy)',
          'Hệ thống AI dự báo sản lượng Thứ Bảy vượt ngưỡng Z-Score > 2.0, khuyến nghị tăng cường xe Van 500kg.',
          'warning',
          0,
          nowStr,
        ],
        [
          makeUuid('a0710000', 4),
          DRIVERS[0].id,
          'Tuyến giao hàng hôm nay đang hoạt động',
          'Bạn đã hoàn thành 5/14 điểm dừng trên tuyến Gò Vấp, thu hộ 2.450.000đ COD.',
          'success',
          0,
          nowStr,
        ],
        [
          makeUuid('a0710000', 5),
          STAFF_USERS[1].id,
          'Đơn SE-' + todayCompact + '-DRV01-07 hẹn giao lại',
          'Tài xế Ngô Văn Tài ghi nhận khách hẹn giao lại sau 4 tiếng tại 412 Nguyễn Oanh.',
          'info',
          1,
          nowStr,
        ],
        [
          makeUuid('a0710000', 6),
          STAFF_USERS[2].id,
          'Đồng bộ GPS thời gian thực ổn định',
          '23/25 tài xế đang trực tuyến trên bản đồ giám sát TP. Hồ Chí Minh.',
          'success',
          1,
          nowStr,
        ],
      ];
      await batchInsert(
        conn,
        'notifications',
        ['id', 'user_id', 'title', 'message', 'type', 'is_read', 'created_at'],
        notifRows,
      );
    }

    if (existingTables.has('reports')) {
      const reportSummaryRows: SqlPrimitive[][] = [];
      for (let w = 12; w >= 1; w--) {
        const wEnd = new Date(now.getTime() - (w - 1) * 7 * 24 * 3600 * 1000);
        const wStart = new Date(wEnd.getTime() - 6 * 24 * 3600 * 1000);
        const totalW = 48 + (12 - w) * 3;
        const successW = Math.round(totalW * 0.84);
        reportSummaryRows.push([
          makeUuid('fe900000', 13 - w),
          STAFF_USERS[1].id,
          formatSqlDate(wStart),
          formatSqlDate(wEnd),
          totalW,
          successW,
          successW * 680000,
        ]);
      }
      await batchInsert(
        conn,
        'reports',
        [
          'id',
          'dispatcher_id',
          'from_date',
          'to_date',
          'total_orders',
          'successful_orders',
          'total_cod_collected',
        ],
        reportSummaryRows,
      );
    }

    // Re-enable Foreign Key Checks
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // ── Final Verification Summary ───────────────────────────────────────────
    const entityTables = [
      'regions',
      'depots',
      'users',
      'drivers',
      'zones',
      'zone_drivers',
      'orders',
      'order_status_histories',
      'routes',
      'stops',
      'proof_of_deliveries',
      'shifts',
      'tracking_logs',
      'password_resets',
    ];
    const extraTables = ['notifications', 'reports'].filter((t) => existingTables.has(t));

    console.log('\n┌────────────────────────────────┬────────────┐');
    console.log('│ MySQL Table (14 Core + Extra)  │  Row Count │');
    console.log('├────────────────────────────────┼────────────┤');
    for (const tbl of [...entityTables, ...extraTables]) {
      const [cntRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      const countVal = Number(cntRows[0]?.cnt ?? 0);
      console.log(`│ ${tbl.padEnd(30)} │ ${String(countVal).padStart(10)} │`);
    }
    console.log('└────────────────────────────────┴────────────┘');

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`\n✅ Completed full HCMC 90-Day + Live Defense seeding in ${elapsedSec}s!`);
    console.log('🔑 Demo Accounts (Password for all accounts: 123456):');
    console.log('   • Web Admin       : admin@smartexpress.vn');
    console.log('   • Web Dispatcher  : dispatcher1@smartexpress.vn');
    console.log(
      '   • Mobile Driver   : driver01@smartexpress.vn (Ngô Văn Tài — Active Route 14 stops in Gò Vấp)',
    );
  } catch (err) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
    console.error('❌ Full production seeder failed:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

void runFullProductionSeeder();
