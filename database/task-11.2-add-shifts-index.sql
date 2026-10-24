-- Migration: Task 11.2 (KLTN-114)
-- Add composite index on shifts(driver_id, status)
-- Purpose: Optimize SELECT ... FOR UPDATE queries during COD accumulation
-- and avoid next-key / table lock escalation leading to deadlocks under concurrent requests.

CREATE INDEX idx_shifts_driver_status ON shifts (driver_id, status);
