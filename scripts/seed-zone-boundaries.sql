-- =============================================================
-- Seed script: update zones with realistic GeoJSON boundaries
-- for Ho Chi Minh City delivery areas.
-- Real zone IDs from delivery_db.zones table.
-- Run: mysql -u root -p delivery_db < seed-zone-boundaries.sql
-- Or via Docker: docker exec -i delivery_mysql env MYSQL_PWD=sapassword
--               mysql -u root delivery_db < seed-zone-boundaries.sql
-- =============================================================

-- Zone 1: Gò Vấp / Bình Thạnh
-- Covers roughly from Nguyễn Kiệm → Bạch Đằng corridor
UPDATE zones
SET boundary_geojson = '{"type":"Polygon","coordinates":[[[106.6450,10.8150],[106.7300,10.8150],[106.7300,10.8750],[106.6450,10.8750],[106.6450,10.8150]]]}'
WHERE id = 'zone0000-0000-0000-0000-000000000001';

-- Zone 2: Trung tâm Q1 / Q3
-- Covers District 1 CBD + District 3
UPDATE zones
SET boundary_geojson = '{"type":"Polygon","coordinates":[[[106.6800,10.7650],[106.7150,10.7650],[106.7150,10.7950],[106.6800,10.7950],[106.6800,10.7650]]]}'
WHERE id = 'zone0000-0000-0000-0000-000000000002';

-- Zone 3: Thủ Đức / Tân Bình / Q12
-- Covers north-east corridor
UPDATE zones
SET boundary_geojson = '{"type":"Polygon","coordinates":[[[106.6700,10.7950],[106.7550,10.7950],[106.7550,10.8750],[106.6700,10.8750],[106.6700,10.7950]]]}'
WHERE id = 'zone0000-0000-0000-0000-000000000003';

-- Verify results
SELECT
  id,
  name,
  CASE
    WHEN boundary_geojson IS NULL THEN 'NULL ❌'
    ELSE CONCAT('OK ✅ (', CHAR_LENGTH(boundary_geojson), ' chars)')
  END AS boundary_status
FROM zones;
