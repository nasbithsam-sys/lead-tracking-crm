DO $$$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_notes;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END $$$;
