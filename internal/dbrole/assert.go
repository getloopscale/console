// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package dbrole verifies, at boot, WHICH database role the control plane
// connects as.
//
// The control plane shares the engine's database (cmd/main.go: "The cloud
// service shares the database with the engine API"). Engine migration 000062
// made the tenant-scoped tables fail-closed under Row Level Security, and
// migration 000063 created `loopruntime_cloud`; a non-owner role holding named,
// auditable cross-tenant policies.
//
// This package exists because pointing DATABASE_URL at the wrong role is
// invisible at runtime. Connecting as the OWNER still works — the owner holds
// DDL and carries the maintenance policy — so nothing breaks, no error is
// logged, and the control plane silently keeps the broad, unnamed privilege
// that 000063 exists to replace. A configuration mistake with no symptom is
// exactly the shape of defect the 2026-08-14 audit found in the engine.
package dbrole

import (
	"context"
	"database/sql"
	"fmt"
)

// Posture is the measured privilege posture of the control plane's connection.
// Every field is read from the live catalog — nothing is inferred from config.
type Posture struct {
	Role      string
	Superuser bool
	BypassRLS bool
	IsOwner   bool // owns a tenant-scoped table, and therefore holds DDL over it
}

func (p Posture) String() string {
	return fmt.Sprintf("role=%q superuser=%v bypassrls=%v owns_tenant_tables=%v",
		p.Role, p.Superuser, p.BypassRLS, p.IsOwner)
}

// HoldsUnnamedPrivilege reports whether this connection crosses tenants through
// something other than the named `*_cloud_cross_tenant` policies.
//
// All three are ways to read every tenant without saying so in pg_policy, and
// the first two additionally carry DDL — meaning a compromised control plane
// could drop FORCE, rewrite a policy, or mint a new bypassing role. That is the
// blast radius migration 000063 narrows.
func (p Posture) HoldsUnnamedPrivilege() bool {
	return p.Superuser || p.BypassRLS || p.IsOwner
}

// Measure reads the connection's actual posture from the catalog.
func Measure(ctx context.Context, db *sql.DB) (Posture, error) {
	var p Posture

	err := db.QueryRowContext(ctx,
		`SELECT current_user,
		        COALESCE(rolsuper, false),
		        COALESCE(rolbypassrls, false)
		   FROM pg_roles WHERE rolname = current_user`,
	).Scan(&p.Role, &p.Superuser, &p.BypassRLS)
	if err != nil {
		return p, fmt.Errorf("dbrole: reading role attributes: %w", err)
	}

	// `tenants` is the probe: it is tenant-scoped, it exists in every
	// deployment, and the control plane reads it on nearly every request.
	err = db.QueryRowContext(ctx,
		`SELECT COALESCE(
		          (SELECT pg_get_userbyid(relowner) = current_user
		             FROM pg_class WHERE relname = 'tenants' AND relkind = 'r'),
		          false)`,
	).Scan(&p.IsOwner)
	if err != nil {
		return p, fmt.Errorf("dbrole: reading table ownership: %w", err)
	}

	return p, nil
}

// AssertControlPlaneRole refuses to serve when the control plane connects with
// a privilege broader than the one it is meant to have.
//
// Deliberately fails closed. Refusing to boot is loud and fixed in seconds by
// repointing DATABASE_URL at `loopruntime_cloud`; running as the owner is silent and
// leaves the control plane with DDL over every tenant's data for as long as
// nobody looks.
//
// This does NOT claim the control plane is tenant-isolated — it is not, and
// migration 000063 says so plainly. Its per-tenant routes still rest on their
// WHERE clauses. What this asserts is the narrower, checkable property: the
// cross-tenant reach it does have is the NAMED one.
func AssertControlPlaneRole(ctx context.Context, db *sql.DB) error {
	posture, err := Measure(ctx, db)
	if err != nil {
		return fmt.Errorf("cannot verify the control plane's database role: %w", err)
	}
	if !posture.HoldsUnnamedPrivilege() {
		return nil
	}

	reason := "the role owns the tenant-scoped tables, so it holds DDL over them and is exempt from their policies"
	switch {
	case posture.Superuser:
		reason = "the role is a SUPERUSER, which bypasses every policy unconditionally"
	case posture.BypassRLS:
		reason = "the role has BYPASSRLS, so isolation policies are never evaluated"
	}

	return fmt.Errorf(
		"refusing to serve: the control plane holds an unnamed cross-tenant privilege: %s.\n"+
			"  cause: %s\n"+
			"  fix:   point DATABASE_URL at the `loopruntime_cloud` role created by engine migration 000063.\n"+
			"         It keeps the cross-tenant reach the control plane genuinely needs (account\n"+
			"         listings, billing aggregates, alert evaluation) through NAMED policies that\n"+
			"         appear in pg_policy — without DDL, and revocable one table at a time",
		posture, reason)
}
