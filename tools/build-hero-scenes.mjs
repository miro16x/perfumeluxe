// Builds the homepage hero's fragrance backgrounds (hero-scenes/) from the
// designs in components/*bg.txt. Run it after adding or editing a design:
//
//   node tools/build-hero-scenes.mjs
//
// Each design keeps its own markup, styles, animation and Atmosphere panel.
// Only these change:
//   - Tailwind's in-browser compiler (prototyping only) is replaced by a
//     stylesheet compiled with Tailwind's CLI from the design's own config.
//   - Lucide is pinned to one version instead of @latest.
//   - scene-bridge.js lets the hero play, pause and steer the scene, and
//     scene-hero.css hides the design's corner button and hint (the hero shows
//     its own Atmosphere button; the pedestal would cover the hint).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* mood (hero-spotlight.js FEATURED) → design file in components/ */
const SCENES = {
  million: '1millionbg',
  sauvage: 'diorbg',
  vendetta: 'valentinobg',
  myslf: 'yslbg',
  coco: 'chanelbg',
  'good-girl': 'goodgirlbg',
  paradoxe: 'pradabg',
  perfect: 'mjperfectbg'
};
const TAILWIND = 'tailwindcss@3.4.17';
const LUCIDE = 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js';

const work = mkdtempSync(join(tmpdir(), 'hero-scenes-'));
const input = join(work, 'input.css');
writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

try {
  for (const [mood, source] of Object.entries(SCENES)) {
    let html = readFileSync(`components/${source}.txt`, 'utf8');

    const config = html.match(/<script>\s*tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*<\/script>\s*/);
    if (!config) throw new Error(`${source}: no tailwind.config block found`);
    const tailwindConfig = Function(`"use strict"; return (${config[1]});`)();

    const cdn = /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/;
    if (!cdn.test(html) || !html.includes('https://unpkg.com/lucide@latest')) {
      throw new Error(`${source}: expected the Tailwind and Lucide script tags`);
    }
    for (const id of ['toggleControlsBtn', 'closeControlsBtn', 'ambientPopover']) {
      if (!html.includes(`id="${id}"`)) throw new Error(`${source}: missing #${id}, which the hero's Atmosphere button needs`);
    }

    html = html
      .replace(config[0], '')
      .replace(cdn, '')
      .replace('https://unpkg.com/lucide@latest', LUCIDE)
      .replace('</head>', `  <!-- Added by tools/build-hero-scenes.mjs -->
  <link rel="stylesheet" href="${mood}.css">
  <link rel="stylesheet" href="scene-hero.css">
  <script src="scene-bridge.js"></script>
</head>`);
    html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>
<!-- Generated from components/${source}.txt by tools/build-hero-scenes.mjs. Edit that file, then rebuild. -->`);
    writeFileSync(`hero-scenes/${mood}.html`, html);

    const configFile = join(work, `${mood}.config.cjs`);
    writeFileSync(configFile, `module.exports = ${JSON.stringify({ ...tailwindConfig, content: [join(process.cwd(), `hero-scenes/${mood}.html`)] })};\n`);
    execFileSync('npx', ['--yes', TAILWIND, '-c', configFile, '-i', input, '-o', `hero-scenes/${mood}.css`, '--minify'], { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log(`hero-scenes/${mood}.html  ← components/${source}.txt`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
