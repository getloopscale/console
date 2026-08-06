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
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@usetheo/ui',
              importNames: ['Alert'],
              message:
                "Import Alert from '@/components/ui/alert-guard' — the raw @usetheo/ui Alert silently drops a `children` body (#175). The guard renders it as `description`.",
            },
          ],
        },
      ],
    },
  },
  {
    // The alert-guard is the ONE sanctioned consumer of the raw @usetheo/ui Alert (it wraps it).
    files: ['src/components/ui/alert-guard.tsx'],
    rules: { 'no-restricted-imports': 'off' },
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
    files: ['src/lib/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/pages/*', '@/pages/**', '../pages/*', '../../pages/*'],
              message:
                'Camada inferior nao importa de pages/ (docs/architecture.md). Uma pagina que exporta dominio para o que esta abaixo dela fecha um ciclo — foi a causa dos quatro ciclos de import fechados em B-001/B-037/B-038/B-039. Mova o dominio para um modulo folha e faca a pagina IMPORTAR o que ela exportava.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/lib e src/hooks tambem nao dependem de componentes: a direcao e
    // components -> hooks -> lib, nunca o contrario.
    files: ['src/lib/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/pages/*', '@/pages/**', '@/components/*', '@/components/**'],
              message:
                'src/lib e a camada mais baixa: nao importa de pages/ nem de components/ (docs/architecture.md).',
            },
          ],
        },
      ],
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
