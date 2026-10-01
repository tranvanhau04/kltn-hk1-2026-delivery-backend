-- =============================================================================
-- Task 7.1: Create shifts table
-- Run this script against the delivery_db database.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `shifts` (
  `id`                VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  `driver_id`         VARCHAR(36)   NOT NULL,
  `start_time`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `end_time`          TIMESTAMP     NULL,
  `status`            VARCHAR(10)   NOT NULL DEFAULT 'OPEN',
  `starting_cash_cod` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `current_latitude`  DECIMAL(10,7) NULL,
  `current_longitude` DECIMAL(10,7) NULL,
  `created_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  CONSTRAINT `fk_shifts_driver`
    FOREIGN KEY (`driver_id`)
    REFERENCES `drivers` (`user_id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  INDEX `idx_shifts_driver_status` (`driver_id`, `status`),
  INDEX `idx_shifts_start_time`    (`start_time`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Driver working shifts: tracks shift lifecycle and COD cash balance';

-- =============================================================================
-- Also extend drivers.current_shift_status to accommodate ON_DUTY value.
-- The column is VARCHAR(20) so existing data is not affected; just documenting.
-- =============================================================================
-- ALTER TABLE `drivers`
--   MODIFY COLUMN `current_shift_status` VARCHAR(20) NOT NULL DEFAULT 'OFFLINE';
-- (No-op: column already VARCHAR(20) — no action required.)
