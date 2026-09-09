-- ============================================================================
-- SCRIPT KHỞI TẠO CƠ SỞ DỮ LIỆU LOGISTICS CHO MYSQL 8.0 (DELIVERY_DB)
-- Tương thích hoàn toàn với MySQL 8.0 Docker & Hibernate/JPA/TypeORM
-- Đồng bộ với ERD Diagram & Class Diagram (phiên bản cập nhật)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `delivery_db`
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE `delivery_db`;

-- Vô hiệu hóa kiểm tra khóa ngoại tạm thời để xóa bảng an toàn
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `tracking_logs`;
DROP TABLE IF EXISTS `reports`;
DROP TABLE IF EXISTS `proof_of_deliveries`;
DROP TABLE IF EXISTS `stops`;
DROP TABLE IF EXISTS `routes`;
DROP TABLE IF EXISTS `order_status_histories`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `zone_drivers`;
DROP TABLE IF EXISTS `zones`;
DROP TABLE IF EXISTS `shifts`;
DROP TABLE IF EXISTS `depots`;
DROP TABLE IF EXISTS `drivers`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. BẢNG NGƯỜI DÙNG & PHÂN QUYỀN (USERS)
CREATE TABLE `users` (
    `id` VARCHAR(36) PRIMARY KEY,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `phone` VARCHAR(20) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `chk_user_role` CHECK (`role` IN ('ADMIN', 'DISPATCHER', 'DRIVER')),
    CONSTRAINT `chk_user_status` CHECK (`status` IN ('ACTIVE', 'INACTIVE', 'LOCKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. BẢNG MỞ RỘNG THÔNG TIN TÀI XẾ (DRIVERS)
-- FK = USER.id (one-to-one extension, không có created_at/updated_at riêng theo ERD)
CREATE TABLE `drivers` (
    `user_id`              VARCHAR(36)   NOT NULL PRIMARY KEY,
    `license_plate`        VARCHAR(20)   NOT NULL UNIQUE,
    `vehicle_type`         VARCHAR(30)   NOT NULL,
    `max_weight_kg`        DECIMAL(8, 2) NOT NULL,
    `max_volume_m3`        DECIMAL(8, 3) NOT NULL,
    `current_shift_status` VARCHAR(20)   NOT NULL DEFAULT 'OFFLINE',
    CONSTRAINT `fk_driver_user`          FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `chk_driver_weight`       CHECK (`max_weight_kg` > 0),
    CONSTRAINT `chk_driver_volume`       CHECK (`max_volume_m3` > 0),
    CONSTRAINT `chk_driver_shift_status` CHECK (`current_shift_status` IN ('OFFLINE', 'ONLINE_READY', 'BUSY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. BẢNG KHU VỰC GIAO HÀNG (ZONES)
-- Zone quản lý bởi Dispatcher, boundary_geojson mô tả ranh giới polygon
CREATE TABLE `zones` (
    `id`               VARCHAR(36)  NOT NULL PRIMARY KEY,
    `name`             VARCHAR(100) NOT NULL,
    `boundary_geojson` TEXT         NULL COMMENT 'GeoJSON polygon định nghĩa ranh giới khu vực',
    `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `uq_zone_name` UNIQUE (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. BẢNG ĐIỂM TẬP KẾT / KHO HÀNG (DEPOTS)
-- Không có created_at/updated_at theo ERD
CREATE TABLE `depots` (
    `id`        VARCHAR(36)    NOT NULL PRIMARY KEY,
    `name`      VARCHAR(150)   NOT NULL,
    `address`   TEXT           NOT NULL,
    `latitude`  DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    CONSTRAINT `chk_depot_lat` CHECK (`latitude`  BETWEEN -90  AND 90),
    CONSTRAINT `chk_depot_lng` CHECK (`longitude` BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. BẢNG PHÂN CÔNG TÀI XẾ VÀO KHU VỰC (ZONE_DRIVERS)
-- Bảng pivot nhiều-nhiều: Zone <-> Driver, với thời điểm gán
CREATE TABLE `zone_drivers` (
    `zone_id`     VARCHAR(36) NOT NULL,
    `driver_id`   VARCHAR(36) NOT NULL,
    `assigned_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`zone_id`, `driver_id`),
    CONSTRAINT `fk_zd_zone`   FOREIGN KEY (`zone_id`)   REFERENCES `zones`   (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_zd_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. BẢNG CA LÀM VIỆC CỦA TÀI XẾ (SHIFTS)
-- Thêm reconciled_by (dispatcher đối soát) và reconciled_at (thời điểm đối soát) theo ERD
CREATE TABLE `shifts` (
    `id`            VARCHAR(36)    NOT NULL PRIMARY KEY,
    `driver_id`     VARCHAR(36)    NOT NULL,
    `start_time`    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `end_time`      TIMESTAMP      NULL     DEFAULT NULL,
    `status`        VARCHAR(20)    NOT NULL DEFAULT 'OPEN',
    `cod_collected` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `cod_submitted` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `reconciled_by` VARCHAR(36)    NULL     DEFAULT NULL COMMENT 'dispatcher_id thực hiện đối soát, nullable',
    `reconciled_at` TIMESTAMP      NULL     DEFAULT NULL COMMENT 'thời điểm đối soát hoàn tất, nullable',
    CONSTRAINT `fk_shift_driver`        FOREIGN KEY (`driver_id`)     REFERENCES `drivers` (`user_id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_shift_reconciled`    FOREIGN KEY (`reconciled_by`) REFERENCES `users`   (`id`)      ON DELETE SET NULL,
    CONSTRAINT `chk_shift_status`       CHECK (`status` IN ('OPEN', 'CLOSED')),
    CONSTRAINT `chk_shift_cod_collected` CHECK (`cod_collected` >= 0),
    CONSTRAINT `chk_shift_cod_submitted` CHECK (`cod_submitted` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. BẢNG ĐƠN HÀNG (ORDERS)
-- Thêm zone_id FK → zones (nullable – tự động gán theo tọa độ) theo ERD
CREATE TABLE `orders` (
    `id`               VARCHAR(36)    NOT NULL PRIMARY KEY,
    `code`             VARCHAR(50)    NOT NULL UNIQUE,
    `dispatcher_id`    VARCHAR(36)    NULL     COMMENT 'dispatcher quản lý đơn hàng',
    `zone_id`          VARCHAR(36)    NULL     COMMENT 'khu vực giao hàng, nullable – tự động gán theo tọa độ',
    `receiver_name`    VARCHAR(100)   NOT NULL,
    `receiver_phone`   VARCHAR(20)    NOT NULL,
    `delivery_address` TEXT           NOT NULL,
    `latitude`         DECIMAL(10, 7) NOT NULL,
    `longitude`        DECIMAL(10, 7) NOT NULL,
    `weight_kg`        DECIMAL(8, 2)  NOT NULL,
    `volume_m3`        DECIMAL(8, 3)  NOT NULL,
    `cod_amount`       DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `status`           VARCHAR(20)    NOT NULL DEFAULT 'NEW',
    `created_at`       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_order_dispatcher`  FOREIGN KEY (`dispatcher_id`) REFERENCES `users`  (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_order_zone`        FOREIGN KEY (`zone_id`)       REFERENCES `zones`  (`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_order_coords_lat` CHECK (`latitude`  BETWEEN -90  AND 90),
    CONSTRAINT `chk_order_coords_lng` CHECK (`longitude` BETWEEN -180 AND 180),
    CONSTRAINT `chk_order_weight`     CHECK (`weight_kg`  > 0),
    CONSTRAINT `chk_order_volume`     CHECK (`volume_m3`  > 0),
    CONSTRAINT `chk_order_cod`        CHECK (`cod_amount` >= 0),
    CONSTRAINT `chk_order_status`     CHECK (`status` IN ('NEW', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RESCHEDULED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. BẢNG LỊCH SỬ TRẠNG THÁI ĐƠN HÀNG (ORDER_STATUS_HISTORIES)
CREATE TABLE `order_status_histories` (
    `id`        VARCHAR(36) NOT NULL PRIMARY KEY,
    `order_id`  VARCHAR(36) NOT NULL,
    `status`    VARCHAR(20) NOT NULL,
    `timestamp` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `note`      TEXT        NULL,
    CONSTRAINT `fk_history_order`   FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
    CONSTRAINT `chk_history_status` CHECK (`status` IN ('NEW', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RESCHEDULED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. BẢNG LỘ TRÌNH VRP (ROUTES)
CREATE TABLE `routes` (
    `id`                       VARCHAR(36)   NOT NULL PRIMARY KEY,
    `depot_id`                 VARCHAR(36)   NOT NULL,
    `driver_id`                VARCHAR(36)   NOT NULL,
    `shift_id`                 VARCHAR(36)   NULL     COMMENT 'nullable',
    `dispatcher_id`            VARCHAR(36)   NULL,
    `route_date`               DATE          NOT NULL,
    `total_distance_km`        DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    `total_estimated_time_min` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    `status`                   VARCHAR(20)   NOT NULL DEFAULT 'PLANNED',
    `polyline`                 TEXT          NULL,
    `created_at`               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_route_depot`      FOREIGN KEY (`depot_id`)      REFERENCES `depots`  (`id`)      ON DELETE RESTRICT,
    CONSTRAINT `fk_route_driver`     FOREIGN KEY (`driver_id`)     REFERENCES `drivers` (`user_id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_route_shift`      FOREIGN KEY (`shift_id`)      REFERENCES `shifts`  (`id`)      ON DELETE SET NULL,
    CONSTRAINT `fk_route_dispatcher` FOREIGN KEY (`dispatcher_id`) REFERENCES `users`   (`id`)      ON DELETE SET NULL,
    CONSTRAINT `chk_route_status`    CHECK (`status` IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT `chk_route_distance`  CHECK (`total_distance_km`        >= 0),
    CONSTRAINT `chk_route_time`      CHECK (`total_estimated_time_min` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. BẢNG ĐIỂM DỪNG GIAO HÀNG (STOPS)
CREATE TABLE `stops` (
    `id`          VARCHAR(36) NOT NULL PRIMARY KEY,
    `route_id`    VARCHAR(36) NOT NULL,
    `order_id`    VARCHAR(36) NOT NULL,
    `sequence_no` INT         NOT NULL,
    `arrived_at`  TIMESTAMP   NULL DEFAULT NULL,
    `status`      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT `fk_stop_route`    FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_stop_order`    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `chk_stop_sequence` CHECK (`sequence_no` >= 1),
    CONSTRAINT `chk_stop_status`  CHECK (`status` IN ('PENDING', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED')),
    CONSTRAINT `uq_route_sequence` UNIQUE (`route_id`, `sequence_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. BẢNG XÁC NHẬN GIAO HÀNG (PROOF_OF_DELIVERIES - POD)
CREATE TABLE `proof_of_deliveries` (
    `id`               VARCHAR(36)    NOT NULL PRIMARY KEY,
    `stop_id`          VARCHAR(36)    NOT NULL UNIQUE,
    `photo_url`        TEXT           NULL,
    `cod_collected`    DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `failure_reason`   VARCHAR(255)   NULL,
    `rescheduled_date` TIMESTAMP      NULL     DEFAULT NULL,
    `confirmed_at`     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_pod_stop` FOREIGN KEY (`stop_id`) REFERENCES `stops` (`id`) ON DELETE CASCADE,
    CONSTRAINT `chk_pod_cod` CHECK (`cod_collected` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. BẢNG LOG TỌA ĐỘ GPS REALTIME (TRACKING_LOGS)
-- Thêm shift_id FK để liên kết bản ghi GPS với ca làm việc tương ứng theo ERD
CREATE TABLE `tracking_logs` (
    `id`        VARCHAR(36)    NOT NULL PRIMARY KEY,
    `driver_id` VARCHAR(36)    NOT NULL,
    `shift_id`  VARCHAR(36)    NULL     COMMENT 'ca làm việc khi ghi nhận tọa độ, nullable',
    `latitude`  DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `timestamp` TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_tracking_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`user_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tracking_shift`  FOREIGN KEY (`shift_id`)  REFERENCES `shifts`  (`id`)      ON DELETE SET NULL,
    CONSTRAINT `chk_tracking_lat`   CHECK (`latitude`  BETWEEN -90  AND 90),
    CONSTRAINT `chk_tracking_lng`   CHECK (`longitude` BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. BẢNG BÁO CÁO & ĐỐI SOÁT TỔNG HỢP (REPORTS)
CREATE TABLE `reports` (
    `id`                  VARCHAR(36)    NOT NULL PRIMARY KEY,
    `dispatcher_id`       VARCHAR(36)    NULL,
    `from_date`           TIMESTAMP      NOT NULL,
    `to_date`             TIMESTAMP      NOT NULL,
    `total_orders`        INT            NOT NULL DEFAULT 0,
    `successful_orders`   INT            NOT NULL DEFAULT 0,
    `total_cod_collected` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `created_at`          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_report_dispatcher` FOREIGN KEY (`dispatcher_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_report_dates`     CHECK (`to_date` >= `from_date`),
    CONSTRAINT `chk_report_orders`    CHECK (`successful_orders` <= `total_orders` AND `total_orders` >= 0),
    CONSTRAINT `chk_report_cod`       CHECK (`total_cod_collected` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ĐÁNH CHỈ MỤC (INDEXES) TỐI ƯU HÓA TRUY VẤN REALTIME & TÌM KIẾM
-- ============================================================================
CREATE INDEX `idx_users_role_status`    ON `users`                  (`role`, `status`);
CREATE INDEX `idx_orders_status`        ON `orders`                 (`status`);
CREATE INDEX `idx_orders_zone`          ON `orders`                 (`zone_id`);
CREATE INDEX `idx_orders_coords`        ON `orders`                 (`latitude`, `longitude`);
CREATE INDEX `idx_routes_date_driver`   ON `routes`                 (`route_date`, `driver_id`);
CREATE INDEX `idx_stops_route_sequence` ON `stops`                  (`route_id`, `sequence_no`);
CREATE INDEX `idx_tracking_driver_time` ON `tracking_logs`          (`driver_id`, `timestamp` DESC);
CREATE INDEX `idx_tracking_shift`       ON `tracking_logs`          (`shift_id`);
CREATE INDEX `idx_status_history_order` ON `order_status_histories` (`order_id`, `timestamp`);
CREATE INDEX `idx_zone_drivers_driver`  ON `zone_drivers`           (`driver_id`);
CREATE INDEX `idx_shifts_reconciled`    ON `shifts`                 (`reconciled_by`);


-- ============================================================================
-- SCRIPT MỞ RỘNG DỮ LIỆU MẪU QUY MÔ LỚN (EXTENDED MOCK SEED DATA) CHO DELIVERY_DB
-- ============================================================================

USE `delivery_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- XÓA SẠCH DỮ LIỆU CŨ ĐỂ NẠP BỘ MỚI ĐỒNG BỘ
TRUNCATE TABLE `tracking_logs`;
TRUNCATE TABLE `reports`;
TRUNCATE TABLE `proof_of_deliveries`;
TRUNCATE TABLE `stops`;
TRUNCATE TABLE `routes`;
TRUNCATE TABLE `order_status_histories`;
TRUNCATE TABLE `orders`;
TRUNCATE TABLE `zone_drivers`;
TRUNCATE TABLE `zones`;
TRUNCATE TABLE `shifts`;
TRUNCATE TABLE `depots`;
TRUNCATE TABLE `drivers`;
TRUNCATE TABLE `users`;

-- 1. DANH SÁCH TÀI KHOẢN NGƯỜI DÙNG (USERS)
-- Mật khẩu mặc định: '123456' ($2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S)
INSERT INTO `users` (`id`, `full_name`, `email`, `phone`, `password_hash`, `role`, `status`) VALUES
-- Quản trị viên
('u0000000-0000-0000-0000-000000000001', 'Nguyễn Quản Trị (Admin)', 'admin@smartexpress.vn', '0901000001', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'ADMIN', 'ACTIVE'),
-- Điều phối viên (Dispatchers)
('u0000000-0000-0000-0000-000000000002', 'Trần Điều Phối 01 (Gò Vấp/Bình Thạnh)', 'dieupoi01@smartexpress.vn', '0901000002', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DISPATCHER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000003', 'Lê Điều Phối 02 (Trung Tâm Q1/Q3)', 'dieupoi02@smartexpress.vn', '0901000003', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DISPATCHER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000004', 'Phạm Điều Phối 03 (Thủ Đức/Tân Bình)', 'dieupoi03@smartexpress.vn', '0901000004', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DISPATCHER', 'ACTIVE'),
-- Đội ngũ Tài xế (Drivers)
('u0000000-0000-0000-0000-000000000101', 'Ngô Văn Tài (Xe máy 01)', 'driver01@smartexpress.vn', '0902000101', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000102', 'Phạm Hoàng Nam (Xe máy 02)', 'driver02@smartexpress.vn', '0902000102', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000103', 'Vũ Quốc Bảo (Xe tải Van 500kg)', 'driver03@smartexpress.vn', '0902000103', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000104', 'Đặng Minh Khôi (Xe tải 1 Tấn)', 'driver04@smartexpress.vn', '0902000104', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000105', 'Bùi Anh Tuấn (Xe máy 03)', 'driver05@smartexpress.vn', '0902000105', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000106', 'Đỗ Thành Đạt (Xe máy 04)', 'driver06@smartexpress.vn', '0902000106', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000107', 'Lý Quốc Trọng (Xe tải 1.5 Tấn)', 'driver07@smartexpress.vn', '0902000107', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE'),
('u0000000-0000-0000-0000-000000000108', 'Trương Gia Huy (Xe máy 05)', 'driver08@smartexpress.vn', '0902000108', '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65VU3J5GLIqmi2S', 'DRIVER', 'ACTIVE');

-- 2. HỒ SƠ PHƯƠNG TIỆN TÀI XẾ (DRIVERS)
INSERT INTO `drivers` (`user_id`, `license_plate`, `vehicle_type`, `max_weight_kg`, `max_volume_m3`, `current_shift_status`) VALUES
('u0000000-0000-0000-0000-000000000101', '59G1-987.65', 'MOTORBIKE', 50.00, 0.250, 'BUSY'),
('u0000000-0000-0000-0000-000000000102', '59P2-345.67', 'MOTORBIKE', 60.00, 0.300, 'BUSY'),
('u0000000-0000-0000-0000-000000000103', '51D-890.12', 'VAN_500KG', 500.00, 2.500, 'BUSY'),
('u0000000-0000-0000-0000-000000000104', '51C-678.90', 'TRUCK_1TON', 1000.00, 5.000, 'ONLINE_READY'),
('u0000000-0000-0000-0000-000000000105', '59S3-112.23', 'MOTORBIKE', 50.00, 0.250, 'ONLINE_READY'),
('u0000000-0000-0000-0000-000000000106', '59V1-445.56', 'MOTORBIKE', 55.00, 0.280, 'ONLINE_READY'),
('u0000000-0000-0000-0000-000000000107', '51D-998.88', 'TRUCK_1.5TON', 1500.00, 7.500, 'ONLINE_READY'),
('u0000000-0000-0000-0000-000000000108', '59M2-778.89', 'MOTORBIKE', 50.00, 0.250, 'OFFLINE');

-- 3. KHU VỰC GIAO HÀNG (ZONES)
INSERT INTO `zones` (`id`, `name`, `boundary_geojson`, `created_at`) VALUES
('zone0000-0000-0000-0000-000000000001', 'Khu vực Gò Vấp / Bình Thạnh',       NULL, '2026-08-01 00:00:00'),
('zone0000-0000-0000-0000-000000000002', 'Khu vực Trung Tâm Q1 / Q3',         NULL, '2026-08-01 00:00:00'),
('zone0000-0000-0000-0000-000000000003', 'Khu vực Thủ Đức / Tân Bình / Q12', NULL, '2026-08-01 00:00:00');

-- 4. ĐIỂM TẬP KẾT / KHO TRUNG CHUYỂN CHẶNG CUỐI (DEPOTS)
INSERT INTO `depots` (`id`, `name`, `address`, `latitude`, `longitude`) VALUES
('depot000-0000-0000-0000-000000000001', 'Hub 01 - Trung Tâm Gò Vấp',     '12 Nguyễn Văn Bảo, Phường 4, Quận Gò Vấp, TP.HCM',       10.8222050, 106.6874980),
('depot000-0000-0000-0000-000000000002', 'Hub 02 - Bình Thạnh Hàng Xanh', '178 Điện Biên Phủ, Phường 21, Quận Bình Thạnh, TP.HCM', 10.7983450, 106.7118230),
('depot000-0000-0000-0000-000000000003', 'Hub 03 - Quận 1 Bến Thành',    '120 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM',          10.7721200, 106.6983400);

-- 5. PHÂN CÔNG TÀI XẾ VÀO KHU VỰC (ZONE_DRIVERS)
INSERT INTO `zone_drivers` (`zone_id`, `driver_id`, `assigned_at`) VALUES
-- Zone Gò Vấp / Bình Thạnh → Tài xế 1, 2, 5, 6
('zone0000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000101', '2026-08-01 07:00:00'),
('zone0000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000102', '2026-08-01 07:00:00'),
('zone0000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000105', '2026-08-01 07:00:00'),
('zone0000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000106', '2026-08-01 07:00:00'),
-- Zone Trung Tâm Q1 / Q3 → Tài xế 3 (Van 500kg)
('zone0000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000103', '2026-08-01 07:00:00'),
-- Zone Thủ Đức / Tân Bình → Tài xế 4 (1 Tấn), 7 (1.5 Tấn), 8 (Xe máy)
('zone0000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000104', '2026-08-01 07:00:00'),
('zone0000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000107', '2026-08-01 07:00:00'),
('zone0000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000108', '2026-08-01 07:00:00');

-- 6. CA LÀM VIỆC TÀI XẾ (SHIFTS)
-- reconciled_by và reconciled_at = NULL nếu ca chưa đối soát
INSERT INTO `shifts` (`id`, `driver_id`, `start_time`, `end_time`, `status`, `cod_collected`, `cod_submitted`, `reconciled_by`, `reconciled_at`) VALUES
('shift000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000101', '2026-08-31 07:30:00', NULL, 'OPEN', 1150000.00, 0.00, NULL, NULL),
('shift000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000102', '2026-08-31 08:00:00', NULL, 'OPEN',  820000.00, 0.00, NULL, NULL),
('shift000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000103', '2026-08-31 07:45:00', NULL, 'OPEN', 1950000.00, 0.00, NULL, NULL),
('shift000-0000-0000-0000-000000000004', 'u0000000-0000-0000-0000-000000000104', '2026-08-31 08:15:00', NULL, 'OPEN',       0.00, 0.00, NULL, NULL),
('shift000-0000-0000-0000-000000000005', 'u0000000-0000-0000-0000-000000000105', '2026-08-31 08:30:00', NULL, 'OPEN',       0.00, 0.00, NULL, NULL),
('shift000-0000-0000-0000-000000000006', 'u0000000-0000-0000-0000-000000000106', '2026-08-31 08:30:00', NULL, 'OPEN',       0.00, 0.00, NULL, NULL);

-- 7. DANH SÁCH ĐƠN HÀNG (30 ĐƠN HÀNG ĐỦ CÁC TRẠNG THÁI VÀ KHU VỰC)
-- Thêm zone_id theo khu vực địa lý
INSERT INTO `orders` (`id`, `code`, `dispatcher_id`, `zone_id`, `receiver_name`, `receiver_phone`, `delivery_address`, `latitude`, `longitude`, `weight_kg`, `volume_m3`, `cod_amount`, `status`) VALUES
-- Tuyến 1 (Gò Vấp - Tài xế 1 xe máy):
('ord00000-0000-0000-0000-000000000001', 'ORD-20260831-001', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Chị Mai Linh',    '0918111222', '45 Lê Đức Thọ, Phường 7, Gò Vấp, TP.HCM',          10.8385200, 106.6789100, 1.20, 0.005,   350000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000002', 'ORD-20260831-002', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Anh Tuấn Anh',    '0938333444', '120 Phan Văn Trị, Phường 10, Gò Vấp, TP.HCM',       10.8289100, 106.6743200, 3.50, 0.012,   500000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000003', 'ORD-20260831-003', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Bác Minh Tâm',    '0988555666', '88 Quang Trung, Phường 11, Gò Vấp, TP.HCM',          10.8351000, 106.6621000, 0.80, 0.003,   300000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000004', 'ORD-20260831-004', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Cô Bích Ngọc',    '0977888999', '215 Thống Nhất, Phường 15, Gò Vấp, TP.HCM',          10.8492000, 106.6678000, 2.10, 0.008,   280000.00, 'RESCHEDULED'),
('ord00000-0000-0000-0000-000000000005', 'ORD-20260831-005', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Anh Hữu Phước',   '0944111333', '56 Nguyễn Oanh, Phường 17, Gò Vấp, TP.HCM',           10.8412000, 106.6798000, 5.00, 0.020,        0.00, 'FAILED'),
('ord00000-0000-0000-0000-000000000006', 'ORD-20260831-006', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Nguyễn Thu Thủy', '0903112233', '72 Dương Quảng Hàm, Phường 5, Gò Vấp, TP.HCM',       10.8315000, 106.6901000, 1.10, 0.004,   190000.00, 'IN_TRANSIT'),
('ord00000-0000-0000-0000-000000000007', 'ORD-20260831-007', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Trần Văn Bình',   '0908334455', '310 Cây Trâm, Phường 8, Gò Vấp, TP.HCM',              10.8431000, 106.6542000, 2.80, 0.010,   450000.00, 'IN_TRANSIT'),

-- Tuyến 2 (Bình Thạnh - Tài xế 2 xe máy):
('ord00000-0000-0000-0000-000000000008', 'ORD-20260831-008', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Đỗ Quỳnh Chi',    '0966778899', '89 Phan Đăng Lưu, Phường 7, Phú Nhuận, TP.HCM',      10.8002000, 106.6891000, 0.50, 0.002,   650000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000009', 'ORD-20260831-009', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Nguyễn Thị Hoa',  '0912334455', '34 Bạch Đằng, Phường 24, Bình Thạnh, TP.HCM',      10.8015000, 106.7082000, 1.50, 0.006,   170000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000010', 'ORD-20260831-010', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Hoàng Văn Đông',  '0933445566', '125 Nơ Trang Long, Phường 14, Bình Thạnh, TP.HCM',  10.8112000, 106.6954000, 4.20, 0.015,        0.00, 'IN_TRANSIT'),
('ord00000-0000-0000-0000-000000000011', 'ORD-20260831-011', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Lê Khánh Huyền',  '0979112244', '48 Ung Văn Khiêm, Phường 25, Bình Thạnh, TP.HCM',  10.8033000, 106.7175000, 2.00, 0.008,   520000.00, 'IN_TRANSIT'),
('ord00000-0000-0000-0000-000000000012', 'ORD-20260831-012', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Phan Văn Hưng',   '0981223355', '200 Xô Viết Nghệ Tĩnh, Phường 21, Bình Thạnh, TP.HCM', 10.7961000, 106.7103000, 3.10, 0.011,   310000.00, 'ASSIGNED'),

-- Tuyến 3 (Hàng nặng/cồng kềnh Q1 & Q3 - Xe Van 500kg):
('ord00000-0000-0000-0000-000000000013', 'ORD-20260831-013', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Công Ty TNHH Sao Mai',        '02838221144', '65 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM',              10.7745000, 106.7011000, 45.00,  0.220, 1200000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000014', 'ORD-20260831-014', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Cửa Hàng Điện Máy ABC',       '02839332211', '140 Nam Kỳ Khởi Nghĩa, Phường Bến Thành, Quận 1, TP.HCM', 10.7761000, 106.6965000, 75.00,  0.380,  750000.00, 'DELIVERED'),
('ord00000-0000-0000-0000-000000000015', 'ORD-20260831-015', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Văn Phòng Luật Sư Trí Đức',   '0909556677',  '220 Hai Bà Trưng, Phường Tân Định, Quận 1, TP.HCM',    10.7892000, 106.6923000, 30.00,  0.150,       0.00, 'IN_TRANSIT'),
('ord00000-0000-0000-0000-000000000016', 'ORD-20260831-016', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Showroom Nội Thất Minh Long', '0917889900',  '18 Cách Mạng Tháng 8, Phường Bến Thành, Quận 1, TP.HCM', 10.7715000, 106.6918000, 95.00,  0.550, 2400000.00, 'IN_TRANSIT'),

-- Đơn hàng mới chờ VRP (Zone 1 - Gò Vấp/Bình Thạnh):
('ord00000-0000-0000-0000-000000000017', 'ORD-20260831-017', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Trần Thị Thu Hà',  '0908776655', '50 Hoàng Văn Thụ, Phường 9, Phú Nhuận, TP.HCM',    10.7995000, 106.6778000, 2.00, 0.007,  310000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000018', 'ORD-20260831-018', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Phạm Quỳnh Nga',   '0931224466', '12 Phan Xích Long, Phường 2, Phú Nhuận, TP.HCM',    10.7965000, 106.6902000, 1.80, 0.006,  260000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000019', 'ORD-20260831-019', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Lê Thành Đạt',     '0945667788', '24 Nguyễn Thượng Hiền, Phường 1, Gò Vấp, TP.HCM', 10.8175000, 106.6899000, 0.90, 0.003,  150000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000020', 'ORD-20260831-020', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Ngô Kiến Huy',     '0967889900', '180 Lê Quang Định, Phường 14, Bình Thạnh, TP.HCM', 10.8105000, 106.6961000, 3.20, 0.012,  420000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000021', 'ORD-20260831-021', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Vũ Thảo My',       '0989001122', '95 Chu Văn An, Phường 26, Bình Thạnh, TP.HCM',     10.8122000, 106.7054000, 1.40, 0.005,  590000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000022', 'ORD-20260831-022', 'u0000000-0000-0000-0000-000000000002', 'zone0000-0000-0000-0000-000000000001', 'Huỳnh Lập',        '0913557799', '15 Đinh Bộ Lĩnh, Phường 24, Bình Thạnh, TP.HCM',   10.8041000, 106.7099000, 4.00, 0.018,       0.00, 'NEW'),

-- Đơn hàng mới chờ VRP (Zone 2 - Q1/Q3):
('ord00000-0000-0000-0000-000000000023', 'ORD-20260831-023', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Đặng Thu Thảo',       '0902887766', '36 Lý Tự Trọng, Phường Bến Nghé, Quận 1, TP.HCM',  10.7778000, 106.7018000, 1.00, 0.004,  380000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000024', 'ORD-20260831-024', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Nguyễn Cao Kỳ Duyên', '0937112233', '88 Pasteur, Phường Bến Nghé, Quận 1, TP.HCM',      10.7749000, 106.7001000, 2.50, 0.009,  850000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000025', 'ORD-20260831-025', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Trần Tiểu Vy',        '0972445566', '110 Nguyễn Thị Minh Khai, Phường 6, Quận 3, TP.HCM', 10.7781000, 106.6914000, 1.20, 0.004,  210000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000026', 'ORD-20260831-026', 'u0000000-0000-0000-0000-000000000003', 'zone0000-0000-0000-0000-000000000002', 'Võ Hoàng Yến',        '0919665544', '250 Võ Thị Sáu, Phường Võ Thị Sáu, Quận 3, TP.HCM', 10.7865000, 106.6872000, 5.50, 0.022,  670000.00, 'NEW'),

-- Đơn hàng cồng kềnh chờ xe tải 1 Tấn (Zone 3 - Thủ Đức/Tân Bình):
('ord00000-0000-0000-0000-000000000027', 'ORD-20260831-027', 'u0000000-0000-0000-0000-000000000004', 'zone0000-0000-0000-0000-000000000003', 'Siêu Thị Điện Máy Xanh Q12', '02837155666', '100 Trường Chinh, Phường Tân Hưng Thuận, Quận 12, TP.HCM', 10.8398000, 106.6215000, 180.00, 1.100,  8500000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000028', 'ORD-20260831-028', 'u0000000-0000-0000-0000-000000000004', 'zone0000-0000-0000-0000-000000000003', 'Kho Vật Tư Tân Bình',         '02838445566', '55 Cộng Hòa, Phường 4, Quận Tân Bình, TP.HCM',              10.8012000, 106.6558000, 250.00, 1.450, 12000000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000029', 'ORD-20260831-029', 'u0000000-0000-0000-0000-000000000004', 'zone0000-0000-0000-0000-000000000003', 'Đại Lý Phân Phối Sữa Thủ Đức','02837223344', '15 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM',  10.8512000, 106.7621000, 320.00, 1.800, 15800000.00, 'NEW'),
('ord00000-0000-0000-0000-000000000030', 'ORD-20260831-030', 'u0000000-0000-0000-0000-000000000004', 'zone0000-0000-0000-0000-000000000003', 'Công Ty Thiết Bị Y Tế Hòa Bình','0903998877', '80 Tô Hiến Thành, Phường 15, Quận 10, TP.HCM',            10.7765000, 106.6632000, 120.00, 0.850,  4900000.00, 'NEW');

-- 6. LỊCH SỬ TRẠNG THÁI ĐƠN HÀNG (ORDER_STATUS_HISTORIES)
INSERT INTO `order_status_histories` (`id`, `order_id`, `status`, `timestamp`, `note`) VALUES
('h0000000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000001', 'NEW', '2026-08-31 07:00:00', 'Import từ file Excel'),
('h0000000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000001', 'ASSIGNED', '2026-08-31 07:35:00', 'Gán tự động qua VRP cho Ngô Văn Tài'),
('h0000000-0000-0000-0000-000000000003', 'ord00000-0000-0000-0000-000000000001', 'IN_TRANSIT', '2026-08-31 08:00:00', 'Tài xế nhận hàng rời kho'),
('h0000000-0000-0000-0000-000000000004', 'ord00000-0000-0000-0000-000000000001', 'DELIVERED', '2026-08-31 08:35:00', 'Giao thành công, đã thu COD 350.000đ'),

('h0000000-0000-0000-0000-000000000005', 'ord00000-0000-0000-0000-000000000004', 'NEW', '2026-08-31 07:00:00', 'Import từ file Excel'),
('h0000000-0000-0000-0000-000000000006', 'ord00000-0000-0000-0000-000000000004', 'ASSIGNED', '2026-08-31 07:35:00', 'Gán qua VRP cho Ngô Văn Tài'),
('h0000000-0000-0000-0000-000000000007', 'ord00000-0000-0000-0000-000000000004', 'IN_TRANSIT', '2026-08-31 08:00:00', 'Đang vận chuyển'),
('h0000000-0000-0000-0000-000000000008', 'ord00000-0000-0000-0000-000000000004', 'RESCHEDULED', '2026-08-31 09:30:00', 'Khách bận họp, hẹn giao lại sau 15h00'),

('h0000000-0000-0000-0000-000000000009', 'ord00000-0000-0000-0000-000000000005', 'NEW', '2026-08-31 07:00:00', 'Import từ file Excel'),
('h0000000-0000-0000-0000-000000000010', 'ord00000-0000-0000-0000-000000000005', 'ASSIGNED', '2026-08-31 07:35:00', 'Gán qua VRP cho Ngô Văn Tài'),
('h0000000-0000-0000-0000-000000000011', 'ord00000-0000-0000-0000-000000000005', 'IN_TRANSIT', '2026-08-31 08:00:00', 'Đang vận chuyển'),
('h0000000-0000-0000-0000-000000000012', 'ord00000-0000-0000-0000-000000000005', 'FAILED', '2026-08-31 10:00:00', 'Gọi 3 cuộc khách thuê bao');

-- 7. LỘ TRÌNH VRP (ROUTES) - 3 TUYẾN CHẠY SONG SONG TRONG NGÀY
INSERT INTO `routes` (`id`, `depot_id`, `driver_id`, `shift_id`, `dispatcher_id`, `route_date`, `total_distance_km`, `total_estimated_time_min`, `status`, `polyline`) VALUES
-- Tuyến 1: Gò Vấp (Tài xế Ngô Văn Tài)
('rot00000-0000-0000-0000-000000000001', 'depot000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000002', '2026-08-31', 18.20, 85.00, 'IN_PROGRESS', 'gcn_Cw_fiS|@fBf@d@oBhCe@t@e@x@oAhBm@r@s@z@y@x@w@|@'),
-- Tuyến 2: Bình Thạnh & Phú Nhuận (Tài xế Phạm Hoàng Nam)
('rot00000-0000-0000-0000-000000000002', 'depot000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000102', 'shift000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000002', '2026-08-31', 14.80, 70.00, 'IN_PROGRESS', 's`k_Cm|eiSz@wBh@cCp@uDb@kF|A{Ix@eDt@qCp@kC'),
-- Tuyến 3: Hàng cồng kềnh Q1 & Q3 (Tài xế Vũ Quốc Bảo - Van 500kg)
('rot00000-0000-0000-0000-000000000003', 'depot000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000103', 'shift000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000003', '2026-08-31', 11.50, 90.00, 'IN_PROGRESS', '_mi_C_dfiSx@eDf@yDf@qD|@eEf@kCp@mCh@kC');

-- 8. CÁC ĐIỂM DỪNG GIAO HÀNG (STOPS CỦA TỪNG LỘ TRÌNH)
INSERT INTO `stops` (`id`, `route_id`, `order_id`, `sequence_no`, `arrived_at`, `status`) VALUES
-- Điểm dừng Tuyến 1:
('stp00000-0000-0000-0000-000000000001', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000001', 1, '2026-08-31 08:30:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000002', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000002', 2, '2026-08-31 08:55:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000003', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000003', 3, '2026-08-31 09:15:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000004', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000004', 4, '2026-08-31 09:28:00', 'SKIPPED'),
('stp00000-0000-0000-0000-000000000005', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000005', 5, '2026-08-31 09:55:00', 'FAILED'),
('stp00000-0000-0000-0000-000000000006', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000006', 6, NULL, 'PENDING'),
('stp00000-0000-0000-0000-000000000007', 'rot00000-0000-0000-0000-000000000001', 'ord00000-0000-0000-0000-000000000007', 7, NULL, 'PENDING'),

-- Điểm dừng Tuyến 2:
('stp00000-0000-0000-0000-000000000008', 'rot00000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000008', 1, '2026-08-31 08:40:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000009', 'rot00000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000009', 2, '2026-08-31 09:05:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000010', 'rot00000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000010', 3, NULL, 'PENDING'),
('stp00000-0000-0000-0000-000000000011', 'rot00000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000011', 4, NULL, 'PENDING'),
('stp00000-0000-0000-0000-000000000012', 'rot00000-0000-0000-0000-000000000002', 'ord00000-0000-0000-0000-000000000012', 5, NULL, 'PENDING'),

-- Điểm dừng Tuyến 3:
('stp00000-0000-0000-0000-000000000013', 'rot00000-0000-0000-0000-000000000003', 'ord00000-0000-0000-0000-000000000013', 1, '2026-08-31 08:50:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000014', 'rot00000-0000-0000-0000-000000000003', 'ord00000-0000-0000-0000-000000000014', 2, '2026-08-31 09:35:00', 'COMPLETED'),
('stp00000-0000-0000-0000-000000000015', 'rot00000-0000-0000-0000-000000000003', 'ord00000-0000-0000-0000-000000000015', 3, NULL, 'PENDING'),
('stp00000-0000-0000-0000-000000000016', 'rot00000-0000-0000-0000-000000000003', 'ord00000-0000-0000-0000-000000000016', 4, NULL, 'PENDING');

-- 9. XÁC NHẬN BẰNG CHỨNG GIAO HÀNG (PROOF_OF_DELIVERIES - POD)
INSERT INTO `proof_of_deliveries` (`id`, `stop_id`, `photo_url`, `cod_collected`, `failure_reason`, `rescheduled_date`, `confirmed_at`) VALUES
('pod00000-0000-0000-0000-000000000001', 'stp00000-0000-0000-0000-000000000001', 'https://storage.googleapis.com/smartexpress-pod/pod_ord001.jpg', 350000.00, NULL, NULL, '2026-08-31 08:35:00'),
('pod00000-0000-0000-0000-000000000002', 'stp00000-0000-0000-0000-000000000002', 'https://storage.googleapis.com/smartexpress-pod/pod_ord002.jpg', 500000.00, NULL, NULL, '2026-08-31 09:00:00'),
('pod00000-0000-0000-0000-000000000003', 'stp00000-0000-0000-0000-000000000003', 'https://storage.googleapis.com/smartexpress-pod/pod_ord003.jpg', 300000.00, NULL, NULL, '2026-08-31 09:20:00'),
('pod00000-0000-0000-0000-000000000004', 'stp00000-0000-0000-0000-000000000004', NULL, 0.00, 'Khách bận hẹn giao buổi chiều', '2026-08-31 15:30:00', '2026-08-31 09:30:00'),
('pod00000-0000-0000-0000-000000000005', 'stp00000-0000-0000-0000-000000000005', 'https://storage.googleapis.com/smartexpress-pod/failed_ord005.jpg', 0.00, 'Gọi 3 cuộc không nghe máy / Thuê bao', NULL, '2026-08-31 10:00:00'),
('pod00000-0000-0000-0000-000000000008', 'stp00000-0000-0000-0000-000000000008', 'https://storage.googleapis.com/smartexpress-pod/pod_ord008.jpg', 650000.00, NULL, NULL, '2026-08-31 08:45:00'),
('pod00000-0000-0000-0000-000000000009', 'stp00000-0000-0000-0000-000000000009', 'https://storage.googleapis.com/smartexpress-pod/pod_ord009.jpg', 170000.00, NULL, NULL, '2026-08-31 09:10:00'),
('pod00000-0000-0000-0000-000000000013', 'stp00000-0000-0000-0000-000000000013', 'https://storage.googleapis.com/smartexpress-pod/pod_ord013.jpg', 1200000.00, NULL, NULL, '2026-08-31 09:00:00'),
('pod00000-0000-0000-0000-000000000014', 'stp00000-0000-0000-0000-000000000014', 'https://storage.googleapis.com/smartexpress-pod/pod_ord014.jpg', 750000.00, NULL, NULL, '2026-08-31 09:40:00');

-- 10. NHẬT KÝ TỌA ĐỘ GPS (TRACKING_LOGS)
INSERT INTO `tracking_logs` (`id`, `driver_id`, `shift_id`, `latitude`, `longitude`, `timestamp`) VALUES
-- Xe 1 (Tài xế Ngô Văn Tài - Khu vực Gò Vấp):
('log00000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8222050, 106.6874980, '2026-08-31 08:00:00'),
('log00000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8301000, 106.6830000, '2026-08-31 08:20:00'),
('log00000-0000-0000-0000-000000000003', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8385200, 106.6789100, '2026-08-31 08:35:00'),
('log00000-0000-0000-0000-000000000004', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8289100, 106.6743200, '2026-08-31 08:55:00'),
('log00000-0000-0000-0000-000000000005', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8351000, 106.6621000, '2026-08-31 09:15:00'),
('log00000-0000-0000-0000-000000000006', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8492000, 106.6678000, '2026-08-31 09:30:00'),
('log00000-0000-0000-0000-000000000007', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8412000, 106.6798000, '2026-08-31 09:55:00'),
('log00000-0000-0000-0000-000000000008', 'u0000000-0000-0000-0000-000000000101', 'shift000-0000-0000-0000-000000000001', 10.8330000, 106.6850000, '2026-08-31 10:15:00'),
-- Xe 2 (Tài xế Phạm Hoàng Nam - Khu vực Bình Thạnh):
('log00000-0000-0000-0000-000000000011', 'u0000000-0000-0000-0000-000000000102', 10.8015000, 106.7082000, '2026-08-31 09:10:00'),
('log00000-0000-0000-0000-000000000012', 'u0000000-0000-0000-0000-000000000102', 10.8070000, 106.7020000, '2026-08-31 09:40:00'),

-- Xe 3 (Tài xế Vũ Quốc Bảo - Van 500kg khu vực Quận 1):
('log00000-0000-0000-0000-000000000013', 'u0000000-0000-0000-0000-000000000103', 10.7721200, 106.6983400, '2026-08-31 08:00:00'),
('log00000-0000-0000-0000-000000000014', 'u0000000-0000-0000-0000-000000000103', 10.7745000, 106.7011000, '2026-08-31 08:50:00'),
('log00000-0000-0000-0000-000000000015', 'u0000000-0000-0000-0000-000000000103', 10.7761000, 106.6965000, '2026-08-31 09:35:00');

-- 11. BÁO CÁO & ĐỐI SOÁT TỔNG HỢP (REPORTS)
INSERT INTO `reports` (`id`, `dispatcher_id`, `from_date`, `to_date`, `total_orders`, `successful_orders`, `total_cod_collected`) VALUES
('rep00000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000002', '2026-08-17 00:00:00', '2026-08-23 23:59:59', 320, 308, 98500000.00),
('rep00000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000002', '2026-08-24 00:00:00', '2026-08-30 23:59:59', 450, 432, 142800000.00);

SET FOREIGN_KEY_CHECKS = 1;