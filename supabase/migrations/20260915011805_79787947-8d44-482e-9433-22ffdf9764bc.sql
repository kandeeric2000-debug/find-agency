CREATE TABLE public.domain_classifications (
  domain TEXT NOT NULL PRIMARY KEY,
  is_agency BOOLEAN,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'ai',
  company_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_classifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.domain_classifications TO anon;
GRANT ALL ON public.domain_classifications TO service_role;

ALTER TABLE public.domain_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read classifications" ON public.domain_classifications FOR SELECT USING (true);
CREATE POLICY "Anyone can add classifications" ON public.domain_classifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update classifications" ON public.domain_classifications FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER domain_classifications_touch BEFORE UPDATE ON public.domain_classifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();