# Apple-inspired homepage

A premium, product-first marketing homepage built from the design system at
<https://gitreverse.com/designs/apple-com>. No build step, no dependencies —
open `index.html` in a browser.

This project was built for the **OmniRush Frontier Buildathon 2026** in the
**Open Frontier** track.

```
apple-homepage/
├── index.html              # page structure: nav · hero · showcases · promo grid · footer
├── css/styles.css          # tokens, type scale, components, responsive, reduced motion
├── js/main.js              # nav state, mobile menu, product search, reveal-on-scroll
├── assets/*.jpg            # local official Apple product photography, desktop + mobile
├── assets/*.svg            # local Apple mark and retained illustration source files
└── tools/*.mjs             # local server + validation/preview harnesses (built-ins only)
```

## Rebuild from scratch

The project pins Node `24.20.0` in `.nvmrc`, has a lockfile, and includes a
Dockerfile so it can be run without machine-specific paths:

```powershell
npm ci
npm test
npm start
```

Open <http://localhost:8000>. The same container can run the site:

```powershell
docker build -t apple-homepage .
docker run --rm -p 8000:8000 apple-homepage
```

`npm test` is the offline smoke test. It checks local assets, SVG integrity,
accessibility relationships, CSS custom properties, and JavaScript syntax.

## Design tokens

| Role | Token | Value |
| --- | --- | --- |
| Primary action | `--blue` | `#0071E3` (hover `#0077ED`) |
| Accent (dark bands) | `--sky-blue` | `#2997FF` |
| Secondary surface | `--surface` | `#F5F5F7` |
| Text | `--charcoal` / `--ink` | `#333336` / `#1D1D1F` |
| Links & outlined buttons | `--link-blue` | `#0066CC` |
| Dark promo | direct surface | `#000000` |

Type is SF Pro Display / SF Pro Text with system fallbacks. Buttons are pills
with a `980px` radius. Shadows are intentionally absent — separation comes
from surface colour, imagery, and spacing.

## Page rhythm

| Band | Surface | Product |
| --- | --- | --- |
| Hero | white | iPhone family |
| Showcase | pale blue | MacBook Air |
| Showcase | pale cyan | iPad Air |
| Promo grid (2 × 3) | white cards / dark cards | MacBook Pro · AirPods Pro 3 · Watch Series 11 · iPad Pro · Trade In · Apple Card |
| Footer | soft gray | directory + legal |

## Interactions

Hover states are deliberately restrained: pill buttons shift one shade and
product photography makes a barely perceptible 1.2% scale shift. All motion collapses under
`prefers-reduced-motion: reduce`.

## Local preview

Just open the file — there is no build step, no dependencies, and every asset is
a local relative path, so `file://` works as-is:

```powershell
Start-Process index.html     # or just double-click index.html
```

To preview over a real `http://` origin instead, use the bundled
zero-dependency server (Node is required; Python is not):

```powershell
node tools/serve.mjs         # then open http://localhost:8000
node tools/serve.mjs 3000    # or pick your own port
```

Optional checks:

```powershell
node tools/validate.mjs      # asset/a11y/CSS integrity smoke test
node tools/preview.mjs       # headless screenshots into .preview/
node tools/test-interactions.mjs # keyboard/mobile menu/search regression checks
```

The homepage uses local official Apple JPEGs discovered from Apple marketing
pages. `assets/IMAGE-GUIDE.md` records the source URLs, dimensions, cropping
guidance, and desktop/mobile mapping; `assets/apple-assets.json` records the
acquisition metadata. `tools/fetch-assets.mjs --verify` checks those files
without downloading them again.

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`. After pushing the
`main` branch to a public GitHub repository:

1. Open **Settings → Pages** in the repository.
2. Set the source to **GitHub Actions**.
3. Wait for the **Deploy homepage to GitHub Pages** workflow to finish.
4. Use the workflow's published URL as the live deployment URL.

## OmniRush Buildathon submission

From the project folder, check the buildathon state:

```powershell
omnirush buildathon
```

Open the submission form with:

```powershell
omnirush buildathon submit
```

The form asks for the public GitHub repository URL, the live deployment URL,
the demo video URL, the selected track (`Open Frontier`), and a short project
description. The two OmniRush sessions used for this project are recorded by
the CLI automatically.
