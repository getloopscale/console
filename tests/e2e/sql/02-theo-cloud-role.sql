-- The control plane connects as `theo_cloud`, the non-owner role engine migration
-- 000063 creates with PASSWORD NULL and gives its named cross-tenant policies.
-- theo-cloud refuses to serve as the owner (internal/dbrole), so this environment
-- creates the role first, with a password, exactly as the engine's `task db:roles`
-- does before its migrations (usetheoai/theo#438). 000063 then finds it and only
-- adds the grants and policies.
CREATE ROLE theo_cloud LOGIN PASSWORD 'theo_cloud' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE theo TO theo_cloud;
