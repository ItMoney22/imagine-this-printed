-- Lock creator metadata against self-promotion.
--
-- FOUND 2026-08-16, verified against the LIVE production database (pg_policies,
-- pg_trigger — the migration FILES disagree with live, so the live dump is the authority here).
--
-- Vulnerability:
--   * public.user_profiles.role is protected by enforce_user_profile_role_immutable_trigger,
--     but metadata is not.
--   * The UPDATE policy on user_profiles ("Users can update own profile" USING auth.uid() = id)
--     allows users to write to their own row.
--   * Since there is no WITH CHECK or trigger constraint on the metadata column,
--     a user, via the browser with the public anon key, can set metadata.creator = true
--     and creator_royalty_percent, effectively self-granting creator status and setting
--     their payout rate.
--
-- Fix:
--   * A BEFORE INSERT OR UPDATE trigger on public.user_profiles that rejects changes to privileged
--     metadata keys (creator, creator_royalty_percent, and royalty_percent) unless the
--     writer is the service role.

CREATE OR REPLACE FUNCTION public.enforce_user_profile_metadata_immutable()
RETURNS TRIGGER AS $$
BEGIN
  -- Server-side connections (service role key) may always modify metadata.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE: check if privileged metadata keys are changing.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.metadata->'creator' IS DISTINCT FROM OLD.metadata->'creator') OR
       (NEW.metadata->'creator_royalty_percent' IS DISTINCT FROM OLD.metadata->'creator_royalty_percent') OR
       (NEW.metadata->'royalty_percent' IS DISTINCT FROM OLD.metadata->'royalty_percent') THEN
      RAISE EXCEPTION 'permission denied: privileged metadata keys cannot be changed by this user';
    END IF;
  END IF;

  -- On INSERT (defense in depth): prevent non-privileged callers from setting privileged keys.
  IF TG_OP = 'INSERT' THEN
    IF NEW.metadata IS NOT NULL AND (
       NEW.metadata->'creator' IS NOT NULL OR 
       NEW.metadata->'creator_royalty_percent' IS NOT NULL OR 
       NEW.metadata->'royalty_percent' IS NOT NULL) THEN
      RAISE EXCEPTION 'permission denied: privileged metadata keys cannot be set by this user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS enforce_user_profile_metadata_immutable_trigger ON public.user_profiles;

CREATE TRIGGER enforce_user_profile_metadata_immutable_trigger
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_metadata_immutable();
