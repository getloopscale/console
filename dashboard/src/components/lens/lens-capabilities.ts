import {
  Activity,
  BellRing,
  Bot,
  ClipboardCheck,
  Database,
  FlaskConical,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Network,
  Search,
  ShieldCheck,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/**
 * The ONE canonical map of the Observability capabilities (M70). Both the sidebar nav AND the
 * Overview "Explore" grid are generated from this list, so they can never drift again (the audit found
 * three disagreeing maps: sidebar had Dashboards/Queues/Experiments but no Alerts; the Overview grid
 * had Alerts but not those). `group` follows the Arize Observe → Evaluate → Improve narrative;
 * `sidebarOnly` marks the landing (Overview) which is a nav entry but not an Explore destination card.
 */
export type LensGroup = 'Observe' | 'Evaluate' | 'Improve';

export interface LensCapability {
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
  group: LensGroup;
  /** True for nav-only entries that should NOT appear as an Explore card (e.g. the Overview landing). */
  sidebarOnly?: boolean;
}

export const LENS_CAPABILITIES: LensCapability[] = [
  { group: 'Observe', label: 'Overview', path: '/observability', icon: LayoutGrid, description: 'The observability landing.', sidebarOnly: true },
  { group: 'Observe', label: 'Dashboards', path: '/observability/dashboards', icon: LayoutDashboard, description: 'Assemble custom metric boards.' },
  { group: 'Observe', label: 'Traces', path: '/observability/traces', icon: Network, description: 'Explore executions and manage their tags & annotations.' },
  { group: 'Observe', label: 'Sessions', path: '/observability/sessions', icon: ListChecks, description: 'Replay grouped executions.' },
  { group: 'Evaluate', label: 'Datasets', path: '/observability/datasets', icon: Database, description: 'Curate trace datasets for evaluation.' },
  { group: 'Evaluate', label: 'Evaluators', path: '/observability/evaluators', icon: FlaskConical, description: 'Score traces with rule or LLM-judge evaluators.' },
  { group: 'Evaluate', label: 'Guards', path: '/observability/monitors', icon: ShieldCheck, description: 'Gate traces on evaluator thresholds.' },
  { group: 'Evaluate', label: 'Queues', path: '/observability/labeling-queue', icon: ClipboardCheck, description: 'Review and label spans by hand.' },
  { group: 'Evaluate', label: 'Experiments', path: '/observability/experiments', icon: FlaskConical, description: 'Run a dataset through a variant and compare.' },
  { group: 'Evaluate', label: 'Ask', path: '/observability/ask', icon: Search, description: 'Ask the copilot about a trace.' },
  { group: 'Improve', label: 'Agents', path: '/observability/agents', icon: Bot, description: 'The derived catalog of instrumented agents.' },
  { group: 'Improve', label: 'Alerts', path: '/observability/alerts', icon: BellRing, description: 'Get notified when a metric crosses a threshold.' },
  { group: 'Improve', label: 'Webhooks', path: '/observability/webhooks', icon: Webhook, description: 'Register endpoints that receive alert notifications.' },
];

/** The Explore-grid cards (everything the user can navigate INTO — excludes the Overview landing). */
export const LENS_EXPLORE_CARDS = LENS_CAPABILITIES.filter((c) => !c.sidebarOnly);

/** The sidebar groups, in Observe → Evaluate → Improve order, built from the same registry. */
export const LENS_SIDEBAR_GROUPS: { title: LensGroup; items: LensCapability[] }[] = (
  ['Observe', 'Evaluate', 'Improve'] as const
).map((title) => ({ title, items: LENS_CAPABILITIES.filter((c) => c.group === title) }));

// re-export so a consumer that wants the section header icon has it without a second import.
export { Activity };
