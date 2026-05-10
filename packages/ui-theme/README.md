# @transportial/ui-theme

Shared design tokens and base styles for BDI portal apps. Mirrors the Transportial marketing-site palette (dark background, green accents, Outfit/Manrope/Poppins typography).

## Usage

```ts
import "@transportial/ui-theme";
```

This pulls in `tokens.css` (CSS custom properties) and `base.css` (resets, typography, common UI primitives: `.t-app`, `.t-section`, `.t-tabs`, `.t-tab`, `.t-form`, `.t-pill`, `.t-alert`, `.t-log`, `.t-btn`, `.t-btn-secondary`, `.t-btn-ghost`).

To pull just the variables (e.g., for a custom stylesheet):

```ts
import "@transportial/ui-theme/tokens.css";
```
