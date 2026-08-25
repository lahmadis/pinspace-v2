# PinSpace Landing Source-of-Truth Design

## Approved reference

The visual source of truth is `/Users/usmanasif/Downloads/pinspace Landing.dc.html`. It defines a deliberately minimal landing page: a full-viewport PinSpace-yellow field, the lowercase `pinspace.` wordmark, a short Figtree subtitle, two pill actions, and a circular account control.

## Visual system

- Use Figtree for the wordmark, subtitle, and actions. Keep JetBrains Mono available elsewhere in the product, but do not use it for this landing composition.
- Preserve the reference palette exactly: yellow `#FFC800`, ink `#0B0B0B`, green `#14705C`, and paper `#FFFCF0`. These already exist as PinSpace design tokens.
- Render the wordmark as accessible text, not a raster logo: lowercase `pinspace` with a green period. At 1440px it should resolve to the reference's 172px size, 0.85 line height, 900 weight, and tight negative tracking.
- Match the 1440×900 composition while making it responsive: centered content, account control at the top right, buttons side-by-side where space permits and stacked without overflow on narrow screens.
- Remove the current marketing header, multi-section feature grid, decorative rings, and footer from `/`. The legal routes remain available directly.

## Functional behavior

- The account control stays visually consistent with the reference. Signed-in users see their initial and retain the existing accessible account menu. Signed-out users get a matching sign-in control.
- Dashboard is auth-aware: signed-in users go to `/dashboard`; signed-out users go through `/sign-in` with the safe dashboard redirect and existing institution context.
- Enter the network keeps the existing avatar setup flow and routes to `/gallery` with the selected values and demo flag.
- Session loading must not shift the composition. It remains announced to assistive technology and temporarily disables the auth-dependent dashboard action.
- Buttons remain native links/buttons with visible focus, keyboard activation, sufficient targets, and reference hover states.

## Verification

- Component tests cover signed-out, signed-in, loading, account, dashboard, and gallery behavior.
- Source/design tests cover wordmark text, exact palette tokens, Figtree, responsive sizing, and removal of the old landing sections.
- Browser checks cover 360, 768, 1024, 1440, and 1920 widths, keyboard navigation, no overflow, accessibility scan, and a reviewed landing screenshot.
- After the landing match is green, run the existing full unit, type, lint, PinSpace policy, E2E, accessibility, and visual gates to identify functionality regressions.
