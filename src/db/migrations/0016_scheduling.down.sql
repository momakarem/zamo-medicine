-- Rollback ZAMO-SCHED-027 / ZAMO-SCHED-028 :: scheduling tables.

DROP TABLE IF EXISTS slot_holds CASCADE;
DROP TABLE IF EXISTS branch_holidays CASCADE;

-- Note: btree_gist extension is NOT dropped since other tables may use it.
