# Timber starter

A minimal, working **content repo** you copy to stand up a Timber site (SPEC §3: a
site is a thin host pinning a Timber version + its config). Build it locally with the
Timber CLI:

```
timber build . _site      # renders the whole site into ./_site
```

## What's here

- **`templates/default.liquid`** + **`assets/theme.css`** — the default theme (SPEC §13).
  It renders the SEO `<head>`, the top navigation, the page body, and a footer. Customize
  the site by editing these; add `templates/<type>.liquid` to override per content type.
- **`config/schemas/*.yml`** — content types (`pages`, plus a `settings` singleton with
  `page: false` that holds site-wide identity + names the `homepage`).
- **`config/navigation.yml`** — the ordered top navigation (`{ label, ref }` or
  `{ label, url }`).
- **`content/**`** — your content bundles. `content/settings/index.md` is the global
  settings; the object it names as `homepage` renders at the domain root.
- **`.github/workflows/deploy.yml`** — builds the site and deploys it to GitHub Pages on
  every push to `main` (plus manual runs and a daily rebuild). Set **Settings → Pages →
  Source: "GitHub Actions"** and pin `TIMBER_REF` to a Timber release tag.
