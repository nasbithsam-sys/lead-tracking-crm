CREATE INDEX IF NOT EXISTS idx_activity_logs_target_time ON public.activity_logs (target_type, target_id, created_at DESC);
