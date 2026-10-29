# 3D models

The homepage hero (`hero-spotlight.js`) shows the compressed models in `models/web/`.

The originals in this folder (the `Meshy_AI_…glb` files, 20–45 MB each) are kept out of git and out of the deployed site (`.gitignore`, `.assetsignore`). Cloudflare refuses files over 25 MB, and at that size a bottle would take a minute to load on a phone.

## Adding or replacing a model

1. Put the original `.glb` in this folder.
2. Compress it into `models/web/` (from the project root):

   ```
   npx @gltf-transform/cli@4.1.1 optimize models/ORIGINAL.glb models/web/NAME.glb \
     --compress meshopt --texture-compress webp --texture-size 2048 \
     --simplify-ratio 0.25 --simplify-error 0.0005
   ```

   This takes a 25 MB model to about 0.5–1 MB with no visible difference at hero size.
3. Add it to `FEATURED` in `hero-spotlight.js` with the product's `id` from `products-data.js` and a `mood` (its background in `styles.css`, under `[data-mood="…"]`).

The models use meshopt compression, so the page loads the meshopt decoder before model-viewer (see the script tags at the bottom of `index.html`).
