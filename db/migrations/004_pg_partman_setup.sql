-- SPDX-License-Identifier: EUPL-1.2
-- Wire up pg_partman declarative partitioning for the time-based tables.
-- This migration is best-effort: if pg_partman is not installed it's a no-op,
-- and operators are expected to pre-create monthly partitions manually.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman') THEN
    CREATE EXTENSION IF NOT EXISTS pg_partman;
    -- Monthly partitions, retain 18 months, archive older via detach.
    PERFORM partman.create_parent(
      p_parent_table := 'public.tokens_journal',
      p_control := 'issued_at',
      p_type := 'native',
      p_interval := '1 month',
      p_premake := 3
    );
    PERFORM partman.create_parent(
      p_parent_table := 'public.audit_events',
      p_control := 'occurred_at',
      p_type := 'native',
      p_interval := '1 month',
      p_premake := 3
    );
    PERFORM partman.create_parent(
      p_parent_table := 'public.webhook_deliveries',
      p_control := 'created_at',
      p_type := 'native',
      p_interval := '1 month',
      p_premake := 3
    );
    UPDATE partman.part_config
    SET
      infinite_time_partitions = TRUE,
      retention = '18 months',
      retention_keep_table = FALSE
    WHERE parent_table IN (
      'public.tokens_journal',
      'public.audit_events',
      'public.webhook_deliveries'
    );
  END IF;
END
$$;
