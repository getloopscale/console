-- Application roles theo-rag requires since migration 0027 (RLS): the API
-- refuses to serve as a superuser or BYPASSRLS role, and the migrate command
-- grants these roles but never creates them. Copied from theo-rag
-- dev/postgres-roles.sql; keep the two in step when that file changes.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_app') THEN
        CREATE ROLE rag_app LOGIN PASSWORD 'rag_app' NOSUPERUSER NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_worker') THEN
        CREATE ROLE rag_worker LOGIN PASSWORD 'rag_worker' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;
