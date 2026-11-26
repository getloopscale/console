-- The control plane connects as `loop_console`, the non-owner role engine migration
-- 000063 creates with PASSWORD NULL and gives its named cross-tenant policies.
-- loop-console refuses to serve as the owner (internal/dbrole), so this environment
-- creates the role first, with a password, exactly as the engine's `task db:roles`
-- does before its migrations (getloopscale/loopscale#438). 000063 then finds it and only
-- adds the grants and policies.
CREATE ROLE loop_console LOGIN PASSWORD 'loop_console' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE loop_runtime TO loop_console;
