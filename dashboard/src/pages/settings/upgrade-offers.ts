/**
 * O que cada plano oferece a quem já está num — sem preço nem cota (B-136).
 *
 * ## Por que o preço saiu daqui
 *
 * A tela dizia "Upgrade to Pro — $29/mo" e "10 projects, 3 environments, 1000 builds/month" como
 * literais. Nenhum dos dois é verificável por este código: `/v1/billing` descreve APENAS o plano
 * ATUAL (`plan`, `plan_cap`, `plan_price`), e o servidor também não conhece os valores — guarda só
 * os Price IDs do Stripe (`internal/billing/plans.go`), e o valor vive no Stripe. Não existe
 * catálogo de planos em lugar nenhum do produto.
 *
 * Um preço que o produto não consegue verificar é uma promessa que ele não pode cumprir: basta
 * alguém mexer no preço do Stripe para a tela cobrar $29 na frase e $39 no cartão. O checkout do
 * Stripe mostra o valor autoritativo um clique depois, então a informação não se perde — deixa de
 * ser afirmada por quem não sabe.
 *
 * O que fica são os BENEFÍCIOS, que são decisões nossas e não mudam num painel de terceiro.
 *
 * Quando existir um endpoint de catálogo, o preço volta a aparecer — vindo dele, e formatado por
 * `formatPlanPrice`, que já é a formatação única de preço de plano no dashboard.
 * `billing.test.tsx` guarda contra a volta do literal.
 */
export interface OfertaDeUpgrade {
  /** O plano que o botão compra — o argumento de `upgradePlan`. */
  readonly alvo: string;
  readonly titulo: string;
  readonly resumo: string;
  readonly beneficios: readonly string[];
}

export const OFERTA_POR_PLANO: Record<string, OfertaDeUpgrade | undefined> = {
  free: {
    alvo: 'pro',
    titulo: 'Upgrade to Pro',
    resumo: 'For a project that outgrew the free tier.',
    beneficios: [
      'More projects, environments and builds per month',
      'Metered builds beyond the included quota',
    ],
  },
  pro: {
    alvo: 'team',
    titulo: 'Upgrade to Team',
    resumo: 'A whole team or department.',
    beneficios: [
      'Unlimited projects and environments · metered builds (no agent quota)',
      'Per-role permissions: Admin · Deploy · View',
      'Compliance report per build (SBOM)',
      'Priority support',
    ],
  },
};
