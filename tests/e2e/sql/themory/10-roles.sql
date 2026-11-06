-- Application roles theo-memory requires since migration 0029 (RLS): the server
-- refuses to serve as a superuser or BYPASSRLS role. Copied from theo-memory
-- dev/roles.sql; keep the two in step when that file changes.

DO $$
BEGIN
    -- Atende requisição. Contido pelas policies — é esse o ponto.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') THEN
        CREATE ROLE themory_app LOGIN PASSWORD 'themory_app' NOSUPERUSER NOBYPASSRLS;
    END IF;

    -- Trabalho que atravessa workspaces de propósito (retenção, manutenção).
    -- A travessia dele é uma POLICY NOMEADA, criada pela 0029 — enumerável em
    -- pg_policies e revogável por tabela, ao contrário de BYPASSRLS.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
        CREATE ROLE themory_worker LOGIN PASSWORD 'themory_worker' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;
