-- IRON ECHO: the player report (1.11). Read-only queries over public.ie_events (events_schema.sql), run in the Supabase SQL editor.
-- Each block answers one launch criterion of the plan («IRON ECHO: план до релиза», «Что значит идеал»). Change the interval to taste.
-- anon_id = one browser (a random id, no names, no IP); session_id = one visit.

-- 1. The funnel of the last 7 days: opened -> pressed «В ринг» -> camera tried -> camera calibrated -> a bout -> a finished bout -> a rematch
with w as (select * from public.ie_events where ts > now() - interval '7 days')
select 'opened' as step, count(distinct anon_id) as players from w where type = 'page_open'
union all select 'pressed В ринг', count(distinct anon_id) from w where type = 'cta_click'
union all select 'camera tried', count(distinct anon_id) from w where type = 'camera_try'
union all select 'camera calibrated', count(distinct anon_id) from w where type = 'camera_calibrated'
union all select 'started a bout', count(distinct anon_id) from w where type = 'bout_start'
union all select 'finished a bout', count(distinct anon_id) from w where type = 'bout_end'
union all select 'rematch', count(distinct anon_id) from w where type = 'rematch';

-- 2. Why the camera did not start (criterion: >= 70 % of those who pressed «В ринг» get through the camera set-up)
select props->>'reason' as reason, count(*) as times, count(distinct anon_id) as players
from public.ie_events where type = 'camera_fail' and ts > now() - interval '7 days'
group by 1 order by 2 desc;

-- 3. From «В ринг» to the first punch with the camera (criterion: median <= 60 s)
with first_try as (select session_id, min(ts) as t0 from public.ie_events where type = 'camera_try' group by 1),
     first_hit as (select session_id, min(ts) as t1 from public.ie_events where type = 'first_punch' group by 1)
select percentile_cont(0.5) within group (order by extract(epoch from t1 - t0)) as median_s,
       percentile_cont(0.9) within group (order by extract(epoch from t1 - t0)) as p90_s, count(*) as sessions
from first_try join first_hit using (session_id) where t1 > t0 and t1 - t0 < interval '30 minutes';

-- 4. Frames a second by graphics class (criterion: 60 on a laptop with built-in graphics, 30 on a mid phone)
select gpu_class, ua_class, count(*) as samples, round(avg((props->>'avg')::numeric), 1) as avg_fps,
       round(avg((props->>'slowShare')::numeric) * 100, 1) as slow_frames_pct
from public.ie_events where type = 'fps_sample' and ts > now() - interval '7 days'
group by 1, 2 order by samples desc limit 20;

-- 5. The ladder: how far players get, and where they stop (wins per rung, bouts per rung)
select (props->>'rung')::int as rung, count(*) filter (where type = 'bout_start') as bouts,
       count(*) filter (where type = 'ladder_win') as wins
from public.ie_events where type in ('bout_start', 'ladder_win') and props ? 'rung' and (props->>'rung')::int >= 0
group by 1 order by 1;

-- 6. Page errors per browser class (criterion: >= 99 % of visits without an error)
with v as (select session_id, ua_class, bool_or(type = 'error') as had_error from public.ie_events
           where ts > now() - interval '7 days' group by 1, 2)
select ua_class, count(*) as visits, round(100.0 * avg(case when had_error then 0 else 1 end), 1) as clean_pct
from v group by 1 order by visits desc;

-- 7. Coming back the next day (D1, the beta's goal >= 25 %): of the browsers first seen on a day, the share seen again the day after
with first_day as (select anon_id, min(ts)::date as d0 from public.ie_events group by 1),
     days as (select distinct anon_id, ts::date as d from public.ie_events)
select f.d0 as first_day, count(*) as new_players,
       round(100.0 * count(*) filter (where exists (select 1 from days x where x.anon_id = f.anon_id and x.d = f.d0 + 1)) / count(*), 1) as d1_pct
from first_day f where f.d0 > now()::date - 30 group by 1 order by 1 desc;

-- 8. «Что мешало?» on the results screen (1.11). First: how often each answer is picked (camera, late, hard, easy, unclear, slow, fine)
select pick, count(*) as times, count(distinct anon_id) as players
from public.ie_events, unnest(string_to_array(props->>'picks', ',')) as pick
where type = 'feedback' and ts > now() - interval '30 days' group by 1 order by 2 desc;
-- then the latest answers with words
select ts, props->>'picks' as picks, props->>'text' as text, props->>'rung' as rung, props->>'won' as won, props->>'control' as control
from public.ie_events where type = 'feedback' and coalesce(props->>'text', '') <> '' order by ts desc limit 50;
