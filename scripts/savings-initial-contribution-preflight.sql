\set ON_ERROR_STOP on

-- PostgreSQL / psql. Run one explicitly authorized owner/goal pair per execution.
-- Supply owner_id, goal_id, legacy_ended_at (with UTC offset), and legacy_session_timezone.
-- legacy_ended_at must be the verified end of legacy writes, rather than a Git merge time.
-- Pass an empty legacy_session_timezone if the original DB write timezone is unknown.
-- The result is for restricted review. It contains monetary amounts and internal row IDs.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT :'legacy_ended_at' ~
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  AS cutoff_has_explicit_offset
\gset
\if :cutoff_has_explicit_offset
\else
DO $$ BEGIN
  RAISE EXCEPTION 'legacy_ended_at requiere una fecha ISO 8601 con offset explícito';
END $$;
\endif

WITH parameters AS (
  SELECT
    :'owner_id'::integer AS owner_id,
    :'goal_id'::integer AS goal_id,
    :'legacy_ended_at'::timestamptz AS legacy_ended_at,
    NULLIF(:'legacy_session_timezone', '') AS legacy_session_timezone
), legacy_goal AS (
  SELECT g.id, g.user_id, g.created_at, g.current_amount, g.target_amount,
         p.legacy_session_timezone, p.legacy_ended_at,
         (g.created_at AT TIME ZONE 'America/Bogota')::date AS created_on_bogota
  FROM savings_goals AS g
  JOIN parameters AS p ON g.user_id = p.owner_id AND g.id = p.goal_id
  WHERE g.created_at < p.legacy_ended_at
), owned_contributions AS (
  SELECT g.id AS goal_id, c.id AS contribution_id, g.created_on_bogota,
         c.contribution_date, c.amount, g.current_amount,
         (c.created_at = (g.created_at AT TIME ZONE g.legacy_session_timezone)) AS exact_write_timestamp,
         ((c.created_at AT TIME ZONE g.legacy_session_timezone) >= g.legacy_ended_at) AS known_post_cutover,
         (c.contribution_date = g.created_on_bogota) AS same_civil_day,
         (c.amount > 0 AND c.amount <= g.target_amount AND c.amount <= g.current_amount) AS plausible_amount,
         row_number() OVER (ORDER BY c.created_at, c.id) AS observed_order,
         sum(c.amount) OVER () AS total_recorded
  FROM legacy_goal AS g
  JOIN savings_contributions AS c ON c.goal_id = g.id AND c.user_id = g.user_id
), reviewed AS (
  SELECT *,
         count(*) FILTER (WHERE same_civil_day AND plausible_amount AND exact_write_timestamp) OVER ()
           AS exact_match_count
  FROM owned_contributions
)
SELECT goal_id, contribution_id, created_on_bogota, contribution_date, amount, observed_order,
       current_amount AS current_goal_progress, total_recorded AS total_recorded_contributions,
       exact_write_timestamp, same_civil_day, plausible_amount,
       CASE
         WHEN known_post_cutover THEN 'written_after_legacy_cutoff'
         WHEN exact_match_count = 1 AND exact_write_timestamp AND same_civil_day AND plausible_amount
           THEN 'strong_signal_requires_confirmation'
         WHEN exact_write_timestamp OR same_civil_day
           THEN 'ambiguous_requires_review'
         ELSE 'no_initial_savings_signal'
       END AS evidence,
       CASE WHEN known_post_cutover IS NOT TRUE AND plausible_amount AND (exact_write_timestamp OR same_civil_day) THEN
         date_trunc('month', contribution_date::timestamp)::date
       END AS affected_month_if_confirmed,
       CASE WHEN known_post_cutover IS NOT TRUE AND plausible_amount AND (exact_write_timestamp OR same_civil_day) THEN amount END
         AS available_delta_from_affected_month_if_confirmed,
       CASE WHEN known_post_cutover IS NOT TRUE AND plausible_amount AND (exact_write_timestamp OR same_civil_day) THEN -amount END
         AS period_savings_delta_if_confirmed
FROM reviewed
ORDER BY observed_order;

ROLLBACK;
