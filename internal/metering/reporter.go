// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package metering

import (
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/getloopscale/loop-console/internal/billing"
)

// Reporter sends unreported usage records to Stripe.
// Runs as a background cron job (hourly).
type Reporter struct {
	db     *sql.DB
	stripe *billing.StripeClient
	logger *slog.Logger
}

// NewReporter creates a Stripe usage reporter.
func NewReporter(db *sql.DB, stripe *billing.StripeClient, logger *slog.Logger) *Reporter {
	return &Reporter{db: db, stripe: stripe, logger: logger}
}

// ReportPending finds unreported usage records and sends them to Stripe.
// Idempotent: only processes records with reported_to_stripe = false.
// On success, marks them as reported. On failure, leaves them for retry.
func (r *Reporter) ReportPending() error {
	if r.db == nil || r.stripe == nil {
		return nil
	}

	// Claim a batch with FOR UPDATE ... SKIP LOCKED so two replicas (HPA / rolling
	// restart) never report the same usage rows concurrently (find_data_002 —
	// duplicate billing). The transaction is held across the Stripe calls; this is
	// acceptable for an hourly job bounded by LIMIT 100, and the deterministic
	// idempotency key (created_at) is the backstop against double-charge on retry.
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("begin reporter tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op after a successful Commit

	type pending struct {
		id, tenantID, metric, itemID string
		quantity                     int
		createdAt                    time.Time
	}
	// Drain the cursor (scoped closure so rows.Close runs via defer) BEFORE
	// issuing further statements on the same tx — the metered API path below
	// reuses this connection.
	drain := func() ([]pending, error) {
		rows, err := tx.Query(
			// M2: billing is per-Account. Resolve each usage record's subscription
			// via its tenant's Account (a 2nd tenant of an Account has no subscription
			// of its own — joining by tenant_id would silently drop its usage and
			// under-bill the Account).
			`SELECT ur.id, ur.tenant_id, ur.metric, ur.quantity, ur.created_at,
			        COALESCE(s.stripe_subscription_item_id, '')
			 FROM usage_records ur
			 JOIN tenants t ON t.id = ur.tenant_id
			 JOIN subscriptions s ON s.account_id = t.account_id
			 WHERE ur.reported_to_stripe = false
			 AND ur.quantity > 0
			 ORDER BY ur.created_at ASC
			 LIMIT 100
			 FOR UPDATE OF ur SKIP LOCKED`,
		)
		if err != nil {
			return nil, fmt.Errorf("query pending records: %w", err)
		}
		defer func() { _ = rows.Close() }()

		var batch []pending
		for rows.Next() {
			var p pending
			if err := rows.Scan(&p.id, &p.tenantID, &p.metric, &p.quantity, &p.createdAt, &p.itemID); err != nil {
				continue
			}
			batch = append(batch, p)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate pending records: %w", err)
		}
		return batch, nil
	}
	batch, err := drain()
	if err != nil {
		return err
	}

	var reported, failed, skipped, stalled int
	for _, p := range batch {
		// The Stripe metered API needs the subscription ITEM id (si_xxx). If it is
		// not yet known (backfills on the next subscription.updated), skip with a
		// visible WARN rather than reporting against the wrong id (find_data_001).
		if p.itemID == "" {
			// A espera é legítima enquanto o evento ainda pode chegar. Passado o prazo,
			// ela é um travamento — e o WARN de antes não distinguia os dois, então se
			// repetia de hora em hora, para sempre, sem levar ninguém a agir.
			//
			// Medido em 2026-08-11: o único escritor deste campo é o tratador de eventos
			// do Stripe (`internal/billing/webhook.go`), e no app-dev ele recusava todos
			// os eventos por falta do segredo que os verifica. A espera era permanente.
			switch ClassifyPendingItem(p.createdAt, time.Now()) {
			case Stalled:
				stalled++
				r.logger.Error("usage cannot be billed — "+Stalled.Explain(),
					"id", p.id, "tenant", p.tenantID, "metric", p.metric,
					"pending_since", p.createdAt.Format(time.RFC3339))
			default:
				skipped++
				r.logger.Warn("usage report waiting — "+AwaitingBackfill.Explain(),
					"id", p.id, "tenant", p.tenantID, "metric", p.metric)
			}
			continue
		}
		// Use the record's created_at (deterministic) as the usage timestamp so
		// the Stripe idempotency key is STABLE across replicas and retries.
		if err := r.stripe.ReportUsage(p.itemID, int64(p.quantity), p.createdAt.Unix()); err != nil {
			r.logger.Warn("failed to report usage to Stripe",
				"id", p.id, "tenant", p.tenantID, "metric", p.metric, "error", err)
			failed++
			continue
		}
		if _, err := tx.Exec(
			"UPDATE usage_records SET reported_to_stripe = true WHERE id = $1", p.id,
		); err != nil {
			r.logger.Warn("failed to mark usage as reported", "id", p.id, "error", err)
		}
		reported++
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reporter tx: %w", err)
	}

	// `stalled` entra no resumo porque um consumo travado é o único desses contadores
	// que significa dinheiro que ninguém vai cobrar. Deixá-lo fora do resumo repetiria,
	// em escala menor, o erro que este trabalho corrige: o número existir e não aparecer.
	if reported > 0 || failed > 0 || skipped > 0 || stalled > 0 {
		r.logger.Info("usage reporting complete",
			"reported", reported, "failed", failed, "skipped", skipped, "stalled", stalled)
	}
	return nil
}
