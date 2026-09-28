-- Run ONLY against a disposable local database with the cloud schema + plan seed.
-- Counterexamples assert current behavior; they are not desired acceptance criteria.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'audit-owner@example.test'),
 ('22222222-2222-4222-8222-222222222222', 'audit-member@example.test'),
 ('33333333-3333-4333-8333-333333333333', 'audit-guest@example.test');
insert into org2_cloud.profiles(user_id, display_name) values
 ('11111111-1111-4111-8111-111111111111', 'Audit owner'),
 ('22222222-2222-4222-8222-222222222222', 'Audit member'),
 ('33333333-3333-4333-8333-333333333333', 'Audit guest')
on conflict (user_id) do nothing;
insert into org2_cloud.orgs(id, name, owner_user_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Audit fixture', '11111111-1111-4111-8111-111111111111');
insert into org2_cloud.org_memberships(org_id, user_id, role, status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','member','active');
do $$
declare
  org constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  owner_id constant uuid := '11111111-1111-4111-8111-111111111111';
  guest_id constant uuid := '33333333-3333-4333-8333-333333333333';
  file_id uuid;
  resolved jsonb;
  denial text;
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  insert into org2_cloud.cloud_sessions(org_id, session_id, owner_user_id, metadata, visibility, access_mode, last_activity_at)
    values(org, 'audit-shared', owner_id, '{"sourceSessionId":"audit-shared","title":"Audit"}', 'restricted', 'full_replay', now());
  file_id := (org2_cloud.cloud_put_session_file(org, 'audit-shared', 'report.txt', 'YQ==')->>'id')::uuid;
  perform org2_cloud.cloud_create_session_share(org, 'audit-shared', 'replay', null,
    encode(extensions.digest('audit-fixture-token', 'sha256'), 'hex'), null);
  perform set_config('request.jwt.claim.sub', guest_id::text, true);
  resolved := org2_cloud.cloud_resolve_session_share('audit-fixture-token');
  if resolved->>'sessionId' <> 'audit-shared' then raise exception 'guest share resolution failed'; end if;
  begin
    perform org2_cloud.cloud_get_session_file(file_id);
  exception when others then denial := sqlerrm;
  end;
  if denial is distinct from 'ORG2_MEMBER_REQUIRED' then
    raise exception 'expected membership denial, got %', denial;
  end if;
  raise notice 'counterexample: guest token resolves its session, file read denied: %', denial;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  update org2_cloud.cloud_sessions set deleted_at = now() where org_id = org and session_id = 'audit-shared';
  if not exists(select 1 from org2_cloud.shared_session_files where id = file_id) then raise exception 'counterexample changed: file reclaimed on tombstone'; end if;
  raise notice 'counterexample: session tombstone retains attachment quota occupancy';
end;
$$;
rollback;
