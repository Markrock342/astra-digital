-- MIG-010: inventory.expires_at (TEXT NULL) + FEFO-friendly index.
-- Column/index ALTERs run in server/migrate-010.mjs (idempotent).

SELECT 1;
