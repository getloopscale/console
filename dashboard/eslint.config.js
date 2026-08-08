// ESLint flat config (v9+) — created 2026-05-29 to unblock `npm run lint`
// per plan 2026-05-29-login-page-pragmatic-uplift v2.0 Global DoD.
//
// Scope: TypeScript-first minimum viable lint (matches cli/eslint.config.mjs
// pattern). Full React plugin coverage is parked until eslint-plugin-react
// ships ESLint 10 support — peer-range on 7.x caps at eslint@^9.7.
// Until then we (a) stub `react-hooks` so existing
// `// eslint-disable-next-line react-hooks/exhaustive-deps` comments don't
// raise "rule not found" errors, and (b) keep the lint surface focused on
// TypeScript correctness, leaving React-specific drift detection to tsc
// (strict) + vitest + visual smoke.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Shim plugin: declares `react-hooks` rules as no-ops so legacy
// `// eslint-disable-next-line react-hooks/*` comments resolve without
// "rule not found" errors. When eslint-plugin-react-hooks ships ESLint 10
// support, swap this shim for the real plugin.
const reactHooksShim = {
  rules: {
    'exhaustive-deps': { create: () => ({}) },
    'rules-of-hooks': { create: () => ({}) },
  },
};

// M87 — o ban do `Alert` cru. Extraido para constante porque no flat config um
// objeto POSTERIOR SUBSTITUI o valor da mesma regra; ele nao mescla. Enquanto
// este ban era o unico `no-restricted-imports` do arquivo isso nao aparecia.
// Quando B-070 acrescentou os blocos de camada com `patterns`, eles apagaram o
// `paths` daqui em src/components, src/hooks e src/lib — provado com
// `npx eslint --print-config src/components/lens/alert-create-form.tsx`, que
// devolvia so `patterns`. Tres das quatro camadas ficaram sem o ban, em
// silencio, e o override de alert-guard.tsx virou redundante nelas.
//
// A ironia vale registrar: o commit que instalou fronteiras executaveis
// desligou a unica fronteira executavel que ja existia. Toda regra de camada
// abaixo espalha esta constante no MESMO valor de regra.
const BAN_ALERT_CRU = {
  name: '@usetheo/ui',
  importNames: ['Alert'],
  message:
    "Import Alert from '@/components/ui/alert-guard' — the raw @usetheo/ui Alert silently drops a `children` body (#175). The guard renders it as `description`.",
};

// Caminho para `pages/`, por alias E por relativo de QUALQUER profundidade.
// `../pages/*` e `../../pages/*` cobriam so dois niveis: um
// `../../../../pages/team` passava (verificado com uma sonda em
// src/components/a/b/deep.tsx, que acusou o alias e ignorou o relativo).
const GRUPO_PAGES = ['@/pages/*', '@/pages/**', '**/pages/*', '**/pages/**'];
const GRUPO_COMPONENTS = ['@/components/*', '@/components/**', '**/components/*', '**/components/**'];

export default [
  {
    ignores: [
      'dist/**',
      'storybook-static/**',
      'node_modules/**',
      'public/**',
      'referencia/**',
      'docs/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs',
      'vite.config.ts',
      'vitest.config.ts',
      'postcss.config.js',
      'lighthouserc.json',
      '.storybook/**',
      'e2e/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    linterOptions: {
      // Some files carry legacy disable directives whose target rule no
      // longer exists (react-hooks not loaded as a real plugin). Silence
      // the meta-warning until plugin parity is restored.
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooksShim,
    },
    rules: {
      // Match cli/eslint.config.mjs conventions
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Rebaixado para warn: 1 ocorrência pré-existente fora do escopo
      // de qualquer plano ativo. Promover para error em plano de cleanup
      // dedicado, NÃO aqui (plano 2026-05-29 é interface-only).
      'no-useless-assignment': 'warn',
      // M87 — the raw @usetheo/ui `Alert` silently drops a body passed as `children` (usetheodev/
      // theo-cloud#175): it renders only `title`/`description`/`action`. Feature code MUST import
      // `Alert` from `@/components/ui/alert-guard`, which forwards `children` into `description` so the
      // body is always visible. This ban makes a #175-class regression a lint error, dashboard-side
      // (the raw kit line the dashboard pins, @usetheo/ui@0.13.x, cannot itself be type-hardened here).
      // The guard file (`src/components/ui/alert-guard.tsx`) is the sanctioned raw-Alert consumer and is
      // overridden below.
      'no-restricted-imports': ['error', { paths: [BAN_ALERT_CRU] }],
    },
  },

  // ---------------------------------------------------------------------------
  // B-070 — direcao de dependencia entre camadas, VERIFICADA.
  //
  // O `docs/architecture.md` declara a direcao (pages -> components/hooks/lib, e
  // nada abaixo importa de pages). Ate aqui isso era intencao: a unica regra de
  // import executavel do repo banha um simbolo de terceiro, e nem madge nem
  // dependency-cruiser sao devDependencies — existem so como binarios globais na
  // maquina do dev e nunca rodaram em CI. Uma fronteira sem verificacao e uma
  // preferencia, nao uma fronteira.
  //
  // A auditoria mediu que a direcao ja e respeitada em 100% das 1.084 arestas
  // internas: ZERO arestas sobem de components/hooks/lib para pages. Entao esta
  // regra nao pede refactor nenhum — ela impede a PRIMEIRA regressao, que e
  // exatamente quando o custo de reverter ainda e baixo.
  //
  // Usa o `no-restricted-imports` nativo de proposito. A remediacao do achado
  // sugeria `import/no-restricted-paths`, mas `eslint-plugin-import` NAO esta
  // instalado neste projeto — adicionar plugin + resolver de TypeScript para uma
  // regra que o ESLint ja expressa seria pagar dependencia por nada.
  //
  // Escopo deliberadamente MINIMO: so a direcao vertical, que e medidamente
  // limpa hoje. A regra de residencia por feature (ADR-0001) depende do eixo
  // `src/features/` que ainda nao existe; codifica-la agora proibiria imports
  // que nao tem para onde ir.
  // ---------------------------------------------------------------------------
  {
    files: ['src/hooks/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [BAN_ALERT_CRU],
          patterns: [
            {
              group: GRUPO_PAGES,
              message:
                'Camada inferior nao importa de pages/ (docs/architecture.md). Uma pagina que exporta dominio para o que esta abaixo dela fecha um ciclo. Mova o dominio para um modulo folha e faca a pagina IMPORTAR o que ela exportava.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/lib e a camada mais baixa: nao importa de pages/ NEM de components/.
    // Bloco separado porque so aqui o ban de components/ se aplica — mas ele
    // repete `paths` e o grupo de pages, ja que substituir e o comportamento do
    // flat config. Antes este bloco listava so `src/lib/**` embora o comentario
    // afirmasse cobrir hooks tambem; hooks subiu para o bloco acima, onde o ban
    // de components NAO vale (a direcao e components -> hooks, entao um hook
    // importar componente seria a inversao — mas isso e outra regra, e afirmar
    // cobertura que a config nao tem foi o defeito original).
    files: ['src/lib/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [BAN_ALERT_CRU],
          patterns: [
            {
              group: [...GRUPO_PAGES, ...GRUPO_COMPONENTS],
              message:
                'src/lib e a camada mais baixa: nao importa de pages/ nem de components/ (docs/architecture.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // O alert-guard e o UNICO consumidor sancionado do Alert cru — ele o embrulha.
    // POSICAO IMPORTA: este bloco precisa vir DEPOIS de todas as regras de camada.
    // No flat config o ultimo objeto que casa vence; enquanto ele estava antes,
    // o ban de src/components/** era reaplicado por cima e o proprio guard virava
    // erro de lint. Mover para ca e o que torna o 'off' efetivo.
    files: ['src/components/ui/alert-guard.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // ---------------------------------------------------------------------------
  // B-033 — o orcamento de 500 LoC vira regra EXECUTAVEL.
  //
  // Ate aqui ele era citado por tres modulos como se fosse contrato e definido em
  // lugar nenhum: o `architecture.md` que eles referenciavam nao existia (B-010
  // criou), e nao havia verificacao. Uma regra citada, nao localizavel e nao
  // executavel e o pior dos tres estados — cara de cumprir, impossivel de
  // auditar, indistinguivel de folclore.
  //
  // Esta regra NAO pede refactor: ela trava a divida onde esta. Os 18 arquivos
  // que hoje excedem estao listados com o seu tamanho atual, entao a divida e
  // visivel no diff em vez de invisivel no disco. A lista NAO deve crescer; ela
  // encolhe conforme os arquivos sao decompostos (ADR-0002).
  //
  // O caso mais gritante que a lista expoe e `src/app.tsx`: ele estourava o
  // orcamento enquanto o `trace-detail.tsx` era refatorado inteiro por exceder o
  // mesmo limite. Ou a regra vale para a raiz tambem, ou nao vale para ninguem —
  // e agora ela vale, com a excecao registrada em vez de tacita.
  //
  // Testes ficam de fora: um arquivo de teste longo e frequentemente o formato
  // certo (muitos casos pequenos), e o repo tem 43k LOC de teste cuja convencao
  // co-localizada a auditoria recomendou explicitamente NAO mexer.
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
      // Divida registrada (B-033). Cada linha sai daqui quando o arquivo for
      // decomposto; nenhuma linha nova entra sem ADR.
      //
      // O NUMERO E TETO, nao anotacao. Medido em 2026-08-07: a regra cobria quem
      // ENTRA e nao quem ja estava dentro, e OITO dos dezoito tinham crescido —
      // handlers.ts +78, types.ts +48, graph.tsx +26, app.tsx +22. Divida
      // registrada e ilimitada: um arquivo entra a 757 linhas e chega a 1500 sem
      // que nada acuse.
      //
      // `src/lib/loc-budget-ratchet.test.ts` faz o numero ser teto: ele so desce,
      // e tem de bater com o disco exatamente (sem folga onde crescer). Ao
      // decompor, baixe o numero — o progresso passa a ser medido.
      'src/pages/settings/api-keys.tsx', // 575 LOC (era 955 — B-009 extraiu os 4 dialogos)
      'src/pages/promptly/detail.tsx', // 887 LOC
      'src/lib/api/types.ts', // 861 LOC
      'src/lib/mocks/handlers.ts', // 875 LOC
      'src/app.tsx', // 592 LOC (era 779 — B-003 extraiu as 83 declaracoes lazy)
      'src/pages/auth/recovery.tsx', // 711 LOC
      'src/pages/deploy/deployments.tsx', // 704 LOC
      'src/pages/projects/project-connect.tsx', // 696 LOC
      'src/pages/deploy/components/deploy-timeline-hero.tsx', // 677 LOC
      'src/pages/memory/graph.tsx', // 690 LOC
      'src/pages/lens/evaluators.tsx', // 585 LOC
      'src/pages/memory/webhooks.tsx', // 561 LOC
      'src/pages/skills/bundle-detail.tsx', // 539 LOC
      'src/lib/mocks/skills-handlers.ts', // 546 LOC
      'src/pages/settings/billing.tsx', // 531 LOC
      'src/pages/settings/webhooks.tsx', // 534 LOC
      'src/pages/lens/alerts.tsx', // 523 LOC
      'src/pages/projects/projects.tsx', // 513 LOC
    ],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },

  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      // Tests legitimately use `any` for fixture forging and mock typing.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
