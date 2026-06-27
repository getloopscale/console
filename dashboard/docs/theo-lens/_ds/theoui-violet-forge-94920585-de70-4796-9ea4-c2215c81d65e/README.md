# Building with @theokit/ui (Violet Forge)

`@theokit/ui` is a React component library for AI-agent interfaces and cloud
dashboards. Import components from `@theokit/ui`; compose your own layout with
the design system's Tailwind utility classes (below). The look is "Violet
Forge" — Geist Sans/Mono, an electric-violet primary, tight Vercel-style type.

## Setup — no provider required

The design tokens cascade from `:root` (default theme is light), so components
render fully styled with **no wrapper**. Just import the components and the
stylesheet once:

```tsx
import { Button, Card, Badge } from "@theokit/ui";
// styles ship via the bound stylesheet (already loaded in this environment).
```

`ThemeProvider` is OPTIONAL — wrap the app in it only to switch themes at
runtime (`violet-forge` default, plus `classic-paper`, `aurora-terminal`) or to
toggle light/dark via `[data-theme="dark"]`. It is not needed for styling.

## Styling idiom — semantic Tailwind utilities, never literal colors

Style your own layout/markup with the design system's **semantic** Tailwind v4
utility classes. NEVER hand-pick hex/`bg-red-500`-style colors — always use the
semantic token classes so everything stays on-theme and theme-switchable.

Color families (each available as `bg-*`, `text-*`, `border-*`, `ring-*`, and
some as `fill-*`/`stroke-*`):

| Token class | Use for |
|---|---|
| `background` / `foreground` | page surface + default text |
| `card` / `card-foreground` | card/panel surface + its text |
| `popover` / `popover-foreground` | menus, tooltips, overlays |
| `primary` / `primary-foreground` | brand actions (violet) |
| `secondary` / `secondary-foreground` | secondary surfaces |
| `muted` / `muted-foreground` | subtle surfaces + secondary text |
| `accent` / `accent-foreground` | highlights, hover surfaces |
| `border` / `input` / `ring` | borders, field borders, focus ring |
| `destructive` | danger/delete actions (red) |
| `success` / `warning` | status (green / amber) |

Examples: `bg-background text-foreground`, `bg-card border border-border`,
`bg-primary text-primary-foreground`, `text-muted-foreground`,
`border-destructive`, a focus ring via `ring-ring`.

Type scale (use instead of raw `text-lg` etc. for DS rhythm):
`text-display-2xl`, `text-display-xl`, `text-display-lg`, `text-display-md`,
`text-body`, `text-body-sm`, `text-label-caps` (uppercase mono labels),
`text-code-sm`. Font families: `--font-body`, `--font-display` (Geist),
`--font-mono` (Geist Mono).

## Where the truth lives

- The component API for each `<Name>` is its `<Name>.d.ts` (the `<Name>Props`
  interface) — read it before passing props.
- Usage examples + element index are in each `<Name>.prompt.md`.
- The full token/utility CSS is in the bound `styles.css` import closure
  (tokens + the compiled component/utility stylesheet). Read it when you need a
  class or token name not listed above.

## One idiomatic example

```tsx
import { Card, Badge, Button } from "@theokit/ui";

export function DeploymentCard() {
  return (
    <Card className="flex flex-col gap-3 p-4 bg-card border border-border">
      <div className="flex items-center justify-between">
        <span className="text-label-caps text-muted-foreground">Production</span>
        <Badge variant="success">Live</Badge>
      </div>
      <p className="text-body text-foreground">usetheo.dev · deployed 2m ago</p>
      <Button variant="primary" className="self-start">View logs</Button>
    </Card>
  );
}
```

> Code blocks rendered by `CodeBlock`/`ChatMessage`/markdown show plain
> monospace (no syntax-highlight colors) — `shiki` is an optional peer-dep not
> bundled here. Everything else renders in full Violet Forge styling.

# TheoUI (@theokit/ui@0.19.0)

This design system is the published @theokit/ui React library, bundled as a single
browser global. All 158 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.TheoUI`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).
- `guidelines/` — the design system's own usage guidance (7 doc(s), see `guidelines/index.md`). Read these before composing larger layouts.

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.TheoUI.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { AccountMenu } = window.TheoUI;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<AccountMenu />);
```

## Tokens

176 CSS custom properties from ... Names are
preserved verbatim from upstream. See `tokens/` for the full list.

- **color** (88): `--color-primary`, `--color-background`, `--color-foreground`, …
- **spacing** (13): `--space-1`, `--space-2`, `--space-3`, …
- **typography** (4): `--font-display`, `--font-sans`, `--font-mono`, …
- **radius** (8): `--radius-none`, `--radius-sm`, `--radius-md`, …
- **shadow** (5): `--shadow-sm`, `--shadow-md`, `--shadow-lg`, …
- **other** (58): `--ease-out-soft`, `--ease-snap`, `--container-3xs`, …

## Components

### account-menu
- `AccountMenu`

### action-bar
- `ActionBar`

### agent-composer
- `AgentComposer`

### agent-editor
- `AgentEditor`

### agent-error-card
- `AgentErrorCard`

### agent-event
- `AgentEvent` — AgentEvent  single event row in the agent timeline.

### agent-handoff
- `AgentHandoff` — AgentHandoff  visual marker of one agent delegating to another. Pairs

### agent-profile
- `AgentProfile` — AgentProfile  switcher between multiple agent profiles (coder, planner,

### agent-starting-state
- `AgentStartingState` — AgentStartingState  full-width skeleton shown while the agent boots.

### agent-stream
- `AgentStream`

### agent-streaming
- `AgentStreaming`

### agent-timeline
- `AgentTimeline` — AgentTimeline  vertical list of agent events.

### agent-tool-renderer
- `AgentToolRenderer` — Render one ToolUIPart through the registry, falling back to ToolCallPart
- `ToolCallPart`

### primitives
- `Alert`
- `Avatar` (compound: `Avatar.Image`, `Avatar.Fallback`)
- `Badge` (compound: `Badge.Dot`)
- `Button`
- `Card` (compound: `Card.Header`, `Card.Title`, `Card.Description`, `Card.Body`, `Card.Footer`)
- `Checkbox`
- `Dialog` (compound: `Dialog.Trigger`, `Dialog.Close`, `Dialog.Content`, `Dialog.Overlay`, `Dialog.Header`, `Dialog.Body`, …)
- `Input`
- `Label`
- `Pagination`
- `Progress`
- `Select` (compound: `Select.Trigger`, `Select.Value`, `Select.Content`, `Select.Group`, `Select.Label`, `Select.Item`, …)
- `Sheet` (compound: `Sheet.Trigger`, `Sheet.Close`, `Sheet.Content`, `Sheet.Overlay`, `Sheet.Header`, `Sheet.Body`, …)
- `Sidebar` (compound: `Sidebar.Header`, `Sidebar.Section`, `Sidebar.Item`, `Sidebar.Footer`)
- `Skeleton` — Skeleton  placeholder block shown while content is loading.
- `Switch`
- `Table` (compound: `Table.Header`, `Table.Body`, `Table.Row`, `Table.Cell`, `Table.HeaderCell`)
- `Tabs` (compound: `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`)
- `Textarea`
- `Timestamp`
- `Toast` (compound: `Toast.Title`, `Toast.Description`, `Toast.Close`, `Toast.Action`, `Toast.Provider`, `Toast.Viewport`)
- `Tooltip` (compound: `Tooltip.Provider`, `Tooltip.Root`, `Tooltip.Trigger`, `Tooltip.Content`)
- `TopNav` (compound: `TopNav.Left`, `TopNav.Center`, `TopNav.Right`, `TopNav.Breadcrumbs`, `TopNav.ModeSwitcher`)

### approval-card
- `ApprovalCard`

### artifact-preview
- `ArtifactPreview` — ArtifactPreview  shell for previewing a generated artifact (XLSX, PDF, image).

### attachment-chip
- `AttachmentChip` — AttachmentChip  file pill shown in chat composer or message attachments row.

### audit-log-entry
- `AuditLogEntry` — AuditLogEntry  one row in the agent audit log. Tells the user exactly

### auto-compact-notice
- `AutoCompactNotice` — AutoCompactNotice  inline banner warning the user that the agent is

### branch-indicator
- `BranchIndicator`

### browser-controls
- `BrowserControls` — BrowserControls  back/forward/reload + URL bar.

### build-log-stream
- `BuildLogStream` — BuildLogStream  terminal-like log viewer with timestamps + level coloring.

### capability-indicator
- `CapabilityIndicator`

### channel-card
- `ChannelCard` — ChannelCard  inbound gateway connection (Telegram, Discord, Slack, )

### chat-composer
- `ChatComposer` — ChatComposer  message input area, shared by Chat / Code / Infra modes.

### chat-message
- `ChatMessage`
- `ChatMessageActions`
- `ChatMessageBranch`
- `ChatMessageResponse`
- `ChatMessageToolbar`

### general
- `ChatMessageAction`
- `ChatMessageBranchContent`
- `ChatMessageBranchNext`
- `ChatMessageBranchPage`
- `ChatMessageBranchPrevious`
- `ChatMessageBranchSelector`
- `ChatMessageContent`
- `ChatMessageRoot`
- `MCPServerCard` — MCPServerCard  one MCP server entry showing connection status, the tools
- `MCPServerList` — MCPServerList  grouped MCP server inventory with status filter chips.
- `SourceDocumentPart`
- `SourceUrlPart`
- `TaskNode` — TaskNode  single row in a task plan. Renders its own children recursively
- `TheoUIProvider`

### chat-thread
- `ChatThread` — ChatThread  simple vertical container that applies spacing + scroll.

### choice-prompt
- `ChoicePrompt`

### markdown
- `CodeBlock`

### command-palette
- `CommandPalette` — CommandPalette  Cmd+K-style global launcher with full keyboard navigation.

### confirm-dialog
- `ConfirmDialog`

### confirm-prompt
- `ConfirmPrompt`

### context-card
- `ContextCard` — ContextCard  generic informational card for the right inspector.

### context-window-bar
- `ContextWindowBar` — ContextWindowBar  shows how much of the model's context window has been

### copy-button
- `CopyButton`

### cost-meter
- `CostMeter` — CostMeter  gauge for token spend. Two visuals:

### created-files-card
- `CreatedFilesCard` — CreatedFilesCard  surfaces files produced by a completed task.

### cron-job-card
- `CronJobCard` — CronJobCard  one scheduled agent job. Shows cron expression, prompt,

### cron-jobs-list
- `CronJobsList` — CronJobsList  grid of CronJobCards with a sticky new job action.

### danger-zone
- `DangerZone` (compound: `DangerZone.Action`)

### parts
- `DataPart`
- `FilePart`
- `ReasoningPart`
- `TextPart`

### data-table
- `DataTable`

### deployment-row
- `DeploymentRow` — DeploymentRow  one row in a deployment list (table-ish layout).

### diff-viewer
- `DiffViewer` — DiffViewer  unified diff rendering, no external dep.

### domain-config
- `DomainConfig` — DomainConfig  manage custom domains for a project.

### dropdown-menu
- `DropdownMenu` (compound: `DropdownMenu.Trigger`, `DropdownMenu.Portal`, `DropdownMenu.Content`, `DropdownMenu.Item`, `DropdownMenu.CheckboxItem`, `DropdownMenu.RadioItem`, …)

### empty-state
- `EmptyState` — EmptyState  visual placeholder for empty lists / first-run screens.

### env-var-editor
- `EnvVarEditor` — EnvVarEditor  table-like editor for environment variables.

### export-chat-dialog
- `ExportChatDialog`

### folder-context-card
- `FolderContextCard` — FolderContextCard  file/folder tree fragment for the right inspector.

### folder-selector
- `FolderSelector` — FolderSelector  chip showing the active working directory.

### form-field
- `FormField` (compound: `FormField.Label`, `FormField.Control`, `FormField.Hint`, `FormField.Error`)

### gateway-status-indicator
- `GatewayStatusIndicator`

### hook-config
- `HookConfig` — HookConfig  editor for lifecycle hooks (PreToolUse, PostToolUse, Stop).

### hook-event-log
- `HookEventLog` — HookEventLog  chronological list of hook firings, with result tone, the

### intent-selector
- `IntentSelector` — IntentSelector  chip dropdown for picking the agent's intent for the next

### lane-board
- `LaneBoard` — LaneBoard  kanban-style task board with 4 lanes matching the claw-code

### login-split
- `LoginSplit` — LoginSplit  50/50 split layout shell.

### memory-editor
- `MemoryEditor` — MemoryEditor  three-layer Markdown memory editor (global / project /

### mention-menu
- `MentionMenu` — MentionMenu  keyboard-navigable popover for slash-command /

### metric-card
- `MetricCard`

### metrics-panel
- `MetricsPanel` — MetricsPanel  grid of metric tiles for observability dashboards.

### model-card
- `ModelCard` — ModelCard  full info on a model: vendor, context, output cap, pricing,

### model-selector
- `ModelSelector` — ModelSelector  chip dropdown for picking the active LLM.

### multi-select-prompt
- `MultiSelectPrompt`

### page-shell
- `PageShell`

### permission-matrix
- `PermissionMatrix` — PermissionMatrix  tool  path  decision grid for fine-grained access

### permission-modal
- `PermissionModal` — PermissionModal  local-files access prompt built on Dialog.

### pin-input
- `PinInput`

### plan-badge
- `PlanBadge`

### preview-env-card
- `PreviewEnvCard` — PreviewEnvCard  preview environment card surfacing all services from one PR.

### preview-panel
- `PreviewPanel` — PreviewPanel  browser preview with controls + integrated logs slot.

### progress-checklist
- `ProgressChecklist` — ProgressChecklist  right-inspector checklist.

### project-card
- `ProjectCard` — ProjectCard  surface for a project in a project listing.

### project-switcher
- `ProjectSwitcher`

### quick-action-chips
- `QuickActionChips` — QuickActionChips  row of intent chips below a hero composer.

### radio-group
- `RadioGroup` (compound: `RadioGroup.Item`)

### recent-folders-list
- `RecentFoldersList` — RecentFoldersList  recently-used folders for the Files picker.

### rollback-ui
- `RollbackUI` — RollbackUI  instant rollback selector showing recent versions.

### rule-card
- `RuleCard`

### rule-editor
- `RuleEditor`

### running-tasks-panel
- `RunningTasksPanel` — RunningTasksPanel  split list of Running vs Completed tasks.

### run-stats
- `RunStats` — RunStats  inline metric row shown after an agent run.

### run-status-pill
- `RunStatusPill`

### scroll-area
- `ScrollArea` (compound: `ScrollArea.Bar`)

### session-list-item
- `SessionListItem`

### session-timeline
- `SessionTimeline` — SessionTimeline  historical view of past agent sessions with per-row

### skill-card
- `SkillCard` — SkillCard  single skill entry showing what it does, where it came from,

### skill-editor
- `SkillEditor`

### skills-list
- `SkillsList` — SkillsList  grid of SkillCards with optional search + source filter chips.

### social-auth-row
- `SocialAuthRow` — SocialAuthRow  row of OAuth provider buttons.

### stability-bundle-viewer
- `StabilityBundleViewer`

### stat-tile
- `StatTile`

### status-dot
- `StatusDot`

### status-indicator
- `StatusIndicator`

### steps-rail
- `StepsRail` — StepsRail  vertical numbered rail with connecting line.

### sub-agent-dispatch
- `SubAgentDispatch` — SubAgentDispatch  visualization for a Task() / sub-agent invocation.

### system-prompt-editor
- `SystemPromptEditor` — SystemPromptEditor  surface the agent's system prompt with a clear

### task-header
- `TaskHeader` — TaskHeader  title bar for a task pane.

### task-plan
- `TaskPlan` — TaskPlan  hierarchical task plan,  la Claude plan mode.

### terminal-panel
- `TerminalPanel` — TerminalPanel  minimal terminal output viewer.

### text-prompt
- `TextPrompt`

### themes
- `ThemeProvider` — ThemeProvider  central registry + runtime switcher for Theo themes.
- `ThemeScript`
- `ThemeSwitcher` — ThemeSwitcher  drop-in theme + mode picker.

### thinking-level-selector
- `ThinkingLevelSelector`

### toast
- `Toaster` — Toaster  mount once at the app root. Wraps children in a Radix Toast

### token-usage-chart
- `TokenUsageChart` — TokenUsageChart  stacked-bar chart of input vs output tokens over time.

### tool-call
- `ToolCall` — ToolCall  collapsible row representing an agent tool invocation.

### tool-call-card
- `ToolCallCard`

### tool-result
- `ToolResult` — ToolResult  formatted output of a tool invocation.

### tools-list
- `ToolsList` — ToolsList  surface every tool the agent could call, with its enablement

### update-banner
- `UpdateBanner`

### usage-meter
- `UsageMeter`
