# Resilient Aotearoa NZ — Infrastructure Pathways

A prototype dashboard for exploring resilience investments in roads and highways, water and wastewater, and power infrastructure. Costs, B/C ratios, carbon inventories and scores are realistic illustrations, not validated research outputs.

## Website versions

- **Current dashboard:** the main website automatically opens `infrastructure/`.
- **Original dashboard:** available at `original.html`. Its root application files are retained, and also supply shared map behaviour and assets to the infrastructure build.
- [Infrastructure model, mapping sources and development notes](infrastructure/README.md)
- [Original edition documentation](infrastructure/ORIGINAL_README.md)
- [Version notes](CHANGELOG.md)

## Run locally

Run `node infrastructure/serve.cjs` and open <http://127.0.0.1:8017/>. The main page opens the infrastructure edition. Internet access is required for map tiles, fonts and live feeds. The app can also be opened directly using `infrastructure/index.html`.

## Update and publish

1. Edit the infrastructure source modules described in its README.
2. Run `node infrastructure/build-variant.cjs` and `node infrastructure/model.test.cjs`.
3. Commit the source changes together with the generated files, then push `main`.

For GitHub Pages, publish **main / (root)** in the repository's **Settings → Pages**. The root entry page redirects using a relative URL, so the infrastructure edition works under the repository's existing website address. `.nojekyll` keeps the static files unchanged. No hosting migration or package installation is needed.

The check workflow rebuilds the infrastructure edition, checks JavaScript and calculations, and verifies that generated files were committed. Script and stylesheet URLs change with their contents so later updates refresh browser caches.

Keep the existing GitHub commit history. Mark the original commit with `original-dashboard`, and the first infrastructure release with `infrastructure-v1`. Later work uses normal commits on `main`; release tags record versions without replacing history. To restore an older version, revert the relevant update through a new commit.
