-- Add expected_completion_date to public.leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS expected_completion_date text;
