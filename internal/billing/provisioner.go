// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package billing

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
)

// Provisioner handles Stripe customer and subscription provisioning for new users.
// Free tier (starter) is DB-only — no Stripe subscription created (MEET-038).
type Provisioner struct {
	db     *sql.DB
	stripe *StripeClient
	logger *slog.Logger
}

// NewProvisioner creates a billing provisioner.
func NewProvisioner(db *sql.DB, stripe *StripeClient, logger *slog.Logger) *Provisioner {
	return &Provisioner{db: db, stripe: stripe, logger: logger}
}

// ProvisionStarter creates a starter (free) subscription row in the DB.
// No Stripe customer or subscription is created for the free tier.
// Stripe customer is created lazily on first paid action (portal/upgrade).
func (p *Provisioner) ProvisionStarter(ctx context.Context, userID, email, tenantID string) error {
	if p.db == nil {
		return nil // Dev mode without DB
	}

	// Insert subscription row for starter plan (DB-only, no Stripe)
	id, err := generateSubscriptionID()
	if err != nil {
		return err
	}
	_, err = p.db.ExecContext(ctx,
		// M2: one subscription per Account. Derive account_id from the tenant and
		// conflict on account_id, so a 2nd tenant of an existing account does NOT
		// create a 2nd subscription.
		`INSERT INTO subscriptions (id, tenant_id, account_id, plan, status, created_at, updated_at)
		 VALUES ($1, $2, (SELECT account_id FROM tenants WHERE id = $2), 'starter', 'active', now(), now())
		 ON CONFLICT (account_id) DO NOTHING`,
		id, tenantID,
	)
	if err != nil {
		p.logger.Error("failed to provision starter subscription",
			"tenant_id", tenantID,
			"error", err,
		)
		return err
	}

	p.logger.Info("provisioned starter plan",
		"tenant_id", tenantID,
		"email", email,
	)
	return nil
}

// EnsureStripeCustomer lazily creates a Stripe customer if one doesn't exist.
// Called on first billing action (portal visit, upgrade).
// Returns the Stripe customer ID.
func (p *Provisioner) EnsureStripeCustomer(ctx context.Context, tenantID, email, name string) (string, error) {
	if p.db == nil || p.stripe == nil {
		return "", nil
	}

	// M2: the Stripe customer is per-Account (one billing entity). Resolve the
	// tenant's Account once and key everything (lookup, create, link) by it.
	var accountID string
	if err := p.db.QueryRowContext(ctx,
		"SELECT account_id FROM tenants WHERE id = $1", tenantID,
	).Scan(&accountID); err != nil {
		return "", fmt.Errorf("resolve account for stripe customer: %w", err)
	}

	// Check if the Account already has a Stripe customer.
	var customerID sql.NullString
	err := p.db.QueryRowContext(ctx,
		"SELECT stripe_customer_id FROM subscriptions WHERE account_id = $1",
		accountID,
	).Scan(&customerID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if customerID.Valid && customerID.String != "" {
		return customerID.String, nil // Already has a Stripe customer
	}

	// Create the per-Account Stripe customer. The idempotency key is account-scoped
	// (inside CreateCustomer), so two tenants of the SAME account hitting /portal
	// concurrently converge on ONE customer (no duplicate-customer race).
	customer, err := p.stripe.CreateCustomer(email, accountID, name)
	if err != nil {
		p.logger.Error("failed to create Stripe customer",
			"tenant_id", tenantID,
			"error", err,
		)
		return "", err
	}

	// Store customer ID — §1.4: DB failure returns error, not orphan ID
	_, err = p.db.ExecContext(ctx,
		"UPDATE subscriptions SET stripe_customer_id = $1, updated_at = now() WHERE account_id = $2",
		customer.ID, accountID,
	)
	if err != nil {
		p.logger.Error("failed to store Stripe customer ID — customer created in Stripe but not linked",
			"tenant_id", tenantID,
			"customer_id", customer.ID,
			"error", err,
		)
		return "", fmt.Errorf("store customer ID: %w", err)
	}

	p.logger.Info("created Stripe customer",
		"tenant_id", tenantID,
		"customer_id", customer.ID,
	)
	return customer.ID, nil
}

func generateSubscriptionID() (string, error) {
	b := make([]byte, 12)
	// O erro de `crypto/rand.Read` NAO pode ser ignorado aqui. Ignorado, um `b` zerado produz
	// SEMPRE o mesmo id — `sub_000000000000000000000000` — e ids de assinatura colidem em
	// silencio num sistema de billing. Falha de entropia e irrecuperavel neste ponto: nao ha
	// fallback correto, so propagar (Regra 8 — falhe alto, falhe cedo, falhe claro).
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("billing: subscription id entropy unavailable: %w", err)
	}
	return fmt.Sprintf("sub_%x", b), nil
}
