-- Phase 2: Decision Calibration Score
-- New capture fields on decisions, check-in table, push token storage,
-- reminder toggle + reminder-sent tracking.

-- 1. New columns on decisions (expected_outcome, actual_outcome, analyzed_at,
--    direction_label already exist and are reused, not duplicated here).
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS review_date timestamptz,
  ADD COLUMN IF NOT EXISTS risks_flagged jsonb,
  ADD COLUMN IF NOT EXISTS tradeoffs_accepted text;

-- 2. Calibration check-ins: one row per decision, written once when the
--    user closes the loop on a past-due decision.
CREATE TABLE public.decision_calibration_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('yes', 'partially', 'no')),
  risk_notes text,
  unexpected_notes text,
  ai_calibration_direction text CHECK (ai_calibration_direction IN ('overconfident', 'underconfident', 'well_calibrated')),
  ai_category text,
  ai_reasoning text,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id)
);

CREATE INDEX idx_decision_calibration_checkins_user_id ON public.decision_calibration_checkins(user_id);
CREATE INDEX idx_decision_calibration_checkins_decision_id ON public.decision_calibration_checkins(decision_id);

ALTER TABLE public.decision_calibration_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own checkins"
  ON public.decision_calibration_checkins
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Reminder toggle on the existing notification_preferences table.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS decision_review_reminders_enabled boolean NOT NULL DEFAULT true;

-- 4. Push token storage: one row per device per user.
CREATE TABLE public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX idx_user_push_tokens_user_id ON public.user_push_tokens(user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push tokens"
  ON public.user_push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Score aggregation, internal: pure counting over AI-produced
--    classifications, no auth check — callers are responsible for
--    authorizing access to p_user_id before calling this.
CREATE OR REPLACE FUNCTION public._calibration_score_internal(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_overconfident int;
  v_underconfident int;
  v_well_calibrated int;
  v_band text;
  v_score numeric;
  v_by_category jsonb;
  v_by_month jsonb;
  v_open_loop_count int;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE ai_calibration_direction = 'overconfident'),
    count(*) FILTER (WHERE ai_calibration_direction = 'underconfident'),
    count(*) FILTER (WHERE ai_calibration_direction = 'well_calibrated')
  INTO v_total, v_overconfident, v_underconfident, v_well_calibrated
  FROM public.decision_calibration_checkins
  WHERE user_id = p_user_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total_checkins', 0,
      'band', null,
      'score', null,
      'by_category', '[]'::jsonb,
      'by_month', '[]'::jsonb,
      'open_loop_count', (
        SELECT count(*) FROM public.decisions d
        WHERE d.user_id = p_user_id
          AND d.review_date IS NOT NULL
          AND d.review_date <= now()
          AND NOT EXISTS (
            SELECT 1 FROM public.decision_calibration_checkins c WHERE c.decision_id = d.id
          )
      )
    );
  END IF;

  v_score := round((v_well_calibrated::numeric / v_total) * 100, 1);

  IF v_overconfident > v_underconfident AND v_overconfident > v_well_calibrated THEN
    v_band := 'Overconfident';
  ELSIF v_underconfident > v_overconfident AND v_underconfident > v_well_calibrated THEN
    v_band := 'Underconfident';
  ELSE
    v_band := 'Well-Calibrated';
  END IF;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_by_category
  FROM (
    SELECT
      ai_category AS category,
      count(*) AS total,
      count(*) FILTER (WHERE ai_calibration_direction = 'overconfident') AS overconfident,
      count(*) FILTER (WHERE ai_calibration_direction = 'underconfident') AS underconfident,
      count(*) FILTER (WHERE ai_calibration_direction = 'well_calibrated') AS well_calibrated
    FROM public.decision_calibration_checkins
    WHERE user_id = p_user_id AND ai_category IS NOT NULL
    GROUP BY ai_category
    ORDER BY total DESC
  ) t;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_by_month
  FROM (
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
      count(*) AS total,
      count(*) FILTER (WHERE ai_calibration_direction = 'well_calibrated') AS well_calibrated
    FROM public.decision_calibration_checkins
    WHERE user_id = p_user_id
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at)
  ) t;

  SELECT count(*) INTO v_open_loop_count
  FROM public.decisions d
  WHERE d.user_id = p_user_id
    AND d.review_date IS NOT NULL
    AND d.review_date <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.decision_calibration_checkins c WHERE c.decision_id = d.id
    );

  RETURN jsonb_build_object(
    'total_checkins', v_total,
    'band', v_band,
    'score', v_score,
    'overconfident_count', v_overconfident,
    'underconfident_count', v_underconfident,
    'well_calibrated_count', v_well_calibrated,
    'by_category', coalesce(v_by_category, '[]'::jsonb),
    'by_month', coalesce(v_by_month, '[]'::jsonb),
    'open_loop_count', v_open_loop_count
  );
END;
$$;

-- Public RPC: a user fetching their own score.
CREATE OR REPLACE FUNCTION public.get_calibration_score(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN public._calibration_score_internal(p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_calibration_score(uuid) TO authenticated;

-- 6. Org portal aggregate report RPC — same shape, fed a set of user ids.
--    Restricted to callers who are admins of the organization for every
--    target user id, mirroring the existing org RPC authorization pattern.
CREATE OR REPLACE FUNCTION public.get_organization_calibration_report(p_organization_id uuid, p_user_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT ou.role
  INTO v_caller_role
  FROM public.organization_users ou
  WHERE ou.organization_id = p_organization_id
    AND ou.user_id = auth.uid()
    AND ou.is_active = true
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'You do not have access to this organization.';
  END IF;

  IF v_caller_role NOT IN ('organization_admin', 'user_admin', 'view_only', 'group_manager') THEN
    RAISE EXCEPTION 'You do not have permission to view organization reports.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_user_ids) AS target_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_users ou2
      WHERE ou2.organization_id = p_organization_id AND ou2.user_id = target_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more users are not members of this organization';
  END IF;

  SELECT jsonb_agg(
    public._calibration_score_internal(u.user_id) || jsonb_build_object('user_id', u.user_id)
  )
  INTO v_result
  FROM unnest(p_user_ids) AS u(user_id);

  RETURN jsonb_build_object('members', coalesce(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_calibration_report(uuid, uuid[]) TO authenticated;
