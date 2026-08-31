-- Add code column to technicians table for sequential/shared technician codes (e.g., TECH 001, TECH 002)
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS code text;
CREATE INDEX IF NOT EXISTS idx_technicians_code ON public.technicians(code);
