# Timber starter

The beginnings of the scaffold a **content repo** copies to stand up a Timber site
(SPEC §3: a site is a thin host pinning a Timber version + its config).

- **`.github/workflows/deploy.yml`** — builds the site with the Timber generator and
  deploys it to GitHub Pages on every push to `main` (plus manual runs and a daily
  rebuild). Copy it into your content repo, set **Settings → Pages → Source: "GitHub
  Actions"**, and pin `TIMBER_REF` to a Timber release tag.

A content repo also needs `config/schemas/*.yml`, `templates/<type>.liquid` (+
`templates/default.liquid`), and your `content/**` bundles. The **default theme**
(templates + CSS) ships here in Phase 7.
