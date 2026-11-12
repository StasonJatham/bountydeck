# BountyDeck — design system

Tagline: Find vulnerabilities. Earn recognition.

## Brand

- Wordmark: BountyDeck (camel case; no all-caps logo).
- Icon: two offset cards, report lines, blue target point.
- Visual vocabulary: precise, restrained, secure, earned recognition.
- Do not use padlocks, cartoon bugs, cyber-glows or hacker-terminal effects.

## Design tokens

- Page background: `#FAFAF9`
- Surface/card: `#FFFFFF`
- Ink: `#111113`
- Muted text: `#71717A`
- Hairline border: `#E5E7EB`
- Primary action: `#5265E8`
- Primary action foreground: `#FFFFFF`
- Border radius: `10px` cards, `8px` controls, `999px` badges.
- Shadows: none by default; subtle shadow only on floating overlays.
- Fonts: Geist Sans UI, Geist Mono IDs/CVSS/technical fields; self-host locally.

## Component recipes (shadcn/ui)

- `Sidebar`: 248px desktop, collapsible on small screens; top wordmark and organization switcher.
- `Button`: one prominent primary per screen, neutral secondary/outline buttons.
- `Card`: white background, 1px hairline border, 10px radius, no gradient.
- `Badge`: low-emphasis neutral for labels; semantic colors only for severity/status.
- `Table`: compact rows, good filtering and keyboard navigation, sticky header when needed.
- `Tabs`: underline or subtle segmented tabs; do not overuse pills.
- `Dialog/Sheet`: standard shadcn motion; usable with keyboard and focus trap.
- `Form`: aligned labels, inline validation, generous textarea space for PoCs.

## Page layout

- Sidebar: Overview / Programs / My Reports / Leaderboard / Administration (role-gated).
- Header: breadcrumbs, search, organization context, profile menu.
- Overview: three restrained metrics, list of available programs, recent activity.
- Leaderboard: table-first, visible rank/points, optional filters; no podium illustration.
- Triage: dense data table and focused detail pane; severity and state at a glance.

## Theme behavior

- Light theme is the canonical presentation.
- Dark theme must be a semantic-token variant, never inverted via CSS filters.
- Reserve gold/amber for achievements and severity/status indicators; not navigation.

## Constraints

- Fully local: bundle icons, fonts and static assets, no CDN.
- SVG icons used for application UI; use these as a starting point and convert wordmark lettering to outlines before official cross-platform export.
- Reference the project scope, security model and access control requirements from the existing project brief.
