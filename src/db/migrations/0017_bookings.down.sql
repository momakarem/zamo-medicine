-- Rollback ZAMO-BOOK-029 / ZAMO-BOOK-030 :: booking tables.

DROP TABLE IF EXISTS patient_consents CASCADE;
DROP TABLE IF EXISTS booking_status_history CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
