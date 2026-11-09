const mysql = require('mysql2/promise');
const Redis = require('ioredis');

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3308,
    user: 'root',
    password: 'sapassword',
    database: 'delivery_db',
  });

  console.log('Connected to MySQL delivery_db.');

  // 1. Update all drivers to ONLINE_READY
  const [driverRes] = await conn.query("UPDATE drivers SET current_shift_status = 'ONLINE_READY'");
  console.log(`✅ Đã chuyển ${driverRes.affectedRows} tài xế sang trạng thái ONLINE_READY (Sẵn sàng nhận đơn).`);

  // 2. Update all orders to NEW and clear driver_id
  const [orderRes] = await conn.query("UPDATE orders SET status = 'NEW', driver_id = NULL");
  console.log(`✅ Đã chuyển ${orderRes.affectedRows} đơn hàng sang trạng thái NEW (Đơn mới chờ tối ưu VRP).`);

  // 3. Cancel any currently active routes
  const [routeRes] = await conn.query("UPDATE routes SET status = 'CANCELLED' WHERE status IN ('PLANNED', 'IN_PROGRESS')");
  console.log(`✅ Đã huỷ ${routeRes.affectedRows} lộ trình cũ (PLANNED / IN_PROGRESS) để sẵn sàng test mới.`);

  await conn.end();

  // 4. Clear Redis cache
  try {
    const redis = new Redis({ host: 'localhost', port: 6379 });
    await redis.flushdb();
    console.log('✅ Đã xoá sạch Redis Cache (dashboard_stats).');
    redis.disconnect();
  } catch (re) {
    console.warn('Redis flush error:', re.message);
  }

  console.log('\n🎉 Hoàn tất chuẩn bị dữ liệu test!');
}

main().catch(console.error);

