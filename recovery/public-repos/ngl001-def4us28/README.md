# ngl001-def4us28

**Classification:** REPAIR / RUNNABLE-candidate  
**Type:** current implementation — Vite + React SPA  
**Package name:** `ngl001` @ `0.0.0`

## What exists

| Path | Role |
|------|------|
| `package.json` | Scripts: `dev`, `build`, `lint`, `preview` |
| `vite.config.js` | React plugin; `base: '/ngl001-def4us28'` (GitHub Pages path) |
| `index.html` | Vite HTML entry |
| `src/main.jsx` | React mount |
| `src/App.jsx` | Application root (**~4.5 MB** — unusually large; treat as risk) |
| `src/App.css`, `src/index.css` | Styles |
| `src/assets/` | Static assets |
| `public/` | Public static files |
| `.github/` | Workflows (if any) |
| `SECURITY.md`, `activation.txt` | Meta |

## Commands (as declared)

```bash
npm install
npm run dev      # vite
npm run build    # vite build
npm run preview  # vite preview
npm run lint     # eslint .
```

## Verification notes (2026-09-09)

- Structure matches a standard Vite React app.
- Prior README was the generic create-vite template and did not describe this project.
- Local `npm run build` in a clean environment did **not** complete successfully in the audit session (`vite` binary missing after partial install). Re-run `npm install` until `node_modules/.bin/vite` exists, then `npm run build`.
- `App.jsx` size (~4.5 MB) is a red flag for maintainability and CI timeouts; investigate embedded assets or generated content.

## GitHub Pages

`base: '/ngl001-def4us28'` implies deploy under:

```text
https://no-gas-labs-official.github.io/ngl001-def4us28/
```

Confirm Pages is enabled and `dist/` is published before calling the site “live.”

## Limitations

- Default template README previously overstated maturity.
- Build was not green in this audit pass; classify as **candidate runnable**, not verified shipping artifact.
- Political/manifesto content, if present inside `App.jsx`, is application content — not documented here.

## Next action

1. Complete a clean `npm install && npm run build` and record exit code.  
2. If build fails, fix the first error only (likely install or App.jsx size).  
3. Publish `dist/` to Pages only after a green build.  
4. Consider splitting or compressing whatever inflates `App.jsx`.

---

*Template README removed. Facts only.*
