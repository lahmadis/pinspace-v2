# PinSpace System-Wide UI Redesign

## Decision

PinSpace will adopt the PinSpace visual concept across the entire product in one coordinated release. Users will not see a mixture of legacy indigo/gray screens and PinSpace screens. Development may use internal checkpoints, but deployment happens only after the complete interface passes functional, visual, responsive, accessibility, and production-build verification.

## Product principles

- Preserve all existing data, authorization, collaboration, upload, and Supabase behavior.
- Rebuild the PinSpace concept as maintainable React components; do not copy its generated standalone runtime.
- Give every route a deliberate loading, empty, error, success, permission, and destructive-action state.
- Prefer clear navigation and predictable controls over decorative complexity.
- Use motion to explain state changes, with a reduced-motion alternative.
- Meet WCAG 2.2 AA for the core product journeys.

## Visual system

### Core palette

| Role | Value | Usage |
| --- | --- | --- |
| PinSpace yellow | `#FFC800` | Primary actions, selected states, signature accents |
| PinSpace cream | `#FFF3CC` | Warm application canvas |
| Paper | `#FFFCF0` | Cards, dialogs, raised controls |
| Deep green | `#14705C` | Secondary actions, links, focus support |
| Forest | `#0A2F28` | Navigation and immersive surfaces |
| Ink | `#0B0B0B` | Primary text and high-contrast controls |

Additional neutral, success, warning, and destructive colors must be derived as semantic tokens and checked for accessible contrast. Components consume semantic variables rather than raw color literals.

### Typography and shape

- Figtree is the primary interface face.
- JetBrains Mono is reserved for metadata, identifiers, compact navigation labels, and studio controls.
- Bold editorial headings establish PinSpace's identity without reducing information density.
- Rounded rectangles and pills remain consistent through tokenized radii.
- Shadows stay restrained; state and hierarchy should not depend on shadow alone.

## Information architecture

- **Landing:** Brand promise, product explanation, authentication entry points, and legal footer.
- **Authentication and onboarding:** Focused forms with clear progress, recovery, validation, and institutional context.
- **Dashboard:** Projects, shared work, personal work, invitations, archive controls, and creation actions.
- **Network:** Visual discovery of institutions, departments, people, projects, and shared spaces.
- **Workspace:** Project-level organization, room navigation, membership, settings, and creation.
- **Studio/room:** Immersive canvas with compact controls for presence, presentation, comments, sharing, uploads, and room switching.
- **Public and critique views:** Branded but distraction-free viewing and feedback experiences.
- **Settings/admin/legal/debug:** Operational layouts that use the same tokens and components without forcing the immersive room metaphor.

## Responsive model

- Mobile uses drawers or bottom navigation, stacked content, full-width primary actions, and touch-safe controls.
- Tablet uses compact navigation and adaptive two-column layouts.
- Desktop uses persistent navigation, denser grids, and bounded content widths.
- Studio controls support mouse, trackpad, touch, keyboard, browser safe areas, and reduced motion.
- Primary validation widths are 360, 390, 768, 1024, 1440, and 1920 pixels.

## Accessibility model

- Semantic landmarks, headings, forms, buttons, links, dialogs, and menus.
- Full keyboard navigation, logical focus order, focus restoration, and visible focus styles.
- Accessible names for icon-only and 3D controls.
- Text alternatives for meaningful visual information.
- Minimum 44-pixel touch targets where practical.
- Contrast checked for every token combination and interaction state.
- Errors expressed in text and programmatically associated with inputs.
- Reduced-motion support and no motion-dependent functionality.

## Delivery strategy

The release is big-bang, but implementation is dependency-ordered: freeze behavior, build the design foundation, migrate every route, then run full-system verification. A release flag or isolated branch keeps incomplete design work away from users. Legacy styles are removed only after the last route is migrated and the replacement passes the complete regression matrix.

## Acceptance criteria

- Every user-facing route and state uses the PinSpace design system.
- Existing workflows and Supabase contracts remain unchanged unless separately approved.
- No legacy indigo/purple theme remains except where a semantic data visualization explicitly requires it.
- Core journeys meet WCAG 2.2 AA.
- Supported viewport and input-mode checks pass.
- Production build, type checking, linting, automated tests, and browser journeys pass.
- Visual regression baselines are approved for all major routes.
- Release and rollback procedures are documented and tested before deployment.
