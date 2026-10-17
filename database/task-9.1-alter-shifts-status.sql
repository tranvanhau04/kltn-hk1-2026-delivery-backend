-- =============================================================================
-- Task 9.1: Support PENDING_SETTLEMENT in shifts table status
-- Run this script against the delivery_db database.
-- =============================================================================

-- Ensure column `status` in `shifts` is at least VARCHAR(20) to store 'PENDING_SETTLEMENT' (18 chars)
ALTER TABLE `shifts`
  MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN';

-- If there are any CHECK constraints on status, update them to include PENDING_SETTLEMENT
-- ALTER TABLE `shifts` DROP CONSTRAINT IF EXISTS `chk_shift_status`;
-- ALTER TABLE `shifts` ADD CONSTRAINT `chk_shift_status`
--   CHECK (`status` IN ('OPEN', 'PENDING_SETTLEMENT', 'CLOSED'));
