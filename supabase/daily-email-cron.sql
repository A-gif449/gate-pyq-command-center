-- Optional scheduler. Run after deploying daily-study-email.
-- Supabase Dashboard -> Database -> Extensions: enable pg_cron and pg_net first.
-- 15:00 UTC = 20:30 IST.
select cron.schedule(
  'gate-pyq-daily-study-email',
  '30 15 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/daily-study-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
    body := '{}'::jsonb
  );
  $$
);
