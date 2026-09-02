-- Add is_quotation_master to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_quotation_master BOOLEAN DEFAULT false;

-- Add quote_requested_by to leads to track who set it to pending_to_send
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quote_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Create a trigger to automatically set quote_requested_by when status becomes pending_to_send
CREATE OR REPLACE FUNCTION set_quote_requested_by()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending_to_send' AND (OLD.status IS NULL OR OLD.status != 'pending_to_send') THEN
    NEW.quote_requested_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_set_quote_requested_by ON public.leads;
CREATE TRIGGER trigger_set_quote_requested_by
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_requested_by();
