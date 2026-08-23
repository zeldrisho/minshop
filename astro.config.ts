import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { resolveTheme } from "./scripts/theme/themes.ts";
import { themeCssPath, writeThemeArtifacts } from "./scripts/theme/theme-css.ts";

// SSR on Cloudflare Workers. platformProxy lets `astro dev` read bindings
// (D1, R2, vars) from wrangler.jsonc locally.
// Tailwind v4 is wired via its Vite plugin (the old @astrojs/tailwind
// integration is deprecated).

// Which theme this build compiles. Resolved once, here, and shared
// with Tailwind through the #theme-css alias below — the template alias
// and the CSS scope must never disagree, or the build succeeds while shipping
// an unstyled or wrongly styled site. The generated files are written for ALL
// themes and are byte-identical no matter which theme this process selected, so a
// concurrent build for another theme cannot fight a running dev server over
// them (see the design rule in scripts/theme/theme-css.ts).
const theme = resolveTheme();
writeThemeArtifacts();

// Stamp every build with the theme it was compiled for. The deploy scripts
// refuse to ship an artifact whose stamp disagrees with the current
// selection — without this, `deploy --skip-build` happily deploys whatever
// design happened to be in dist/, and nothing ever knows.
const themeStamp = {
  name: "minshop:theme-stamp",
  hooks: {
    "astro:build:done": () => {
      // Static import: a dynamic one is routed through Vite's module runner,
      // which is already closed by the time this hook runs.
      mkdirSync(new URL("./dist", import.meta.url).pathname, { recursive: true });
      writeFileSync(
        new URL("./dist/theme.json", import.meta.url).pathname,
        `${JSON.stringify({ theme: theme.id }, null, 2)}\n`,
      );
    },
  },
};

// Held in a variable rather than inline: `platformProxy` is forwarded verbatim
// to @cloudflare/vite-plugin and is absent from the adapter's re-exported
// Options type, which an inline literal's excess-property check would reject.
const cloudflareAdapterOptions = {
  imageService: "passthrough",
  platformProxy: { enabled: true },
} as const;

export default defineConfig({
  output: "server",
  integrations: [themeStamp],
  // Replaced by the equivalent middleware guard so the bearer-capability
  // /pay/otk_… form can support clients that omit Origin without weakening
  // cookie-authenticated Admin/account forms.
  security: { checkOrigin: false },
  adapter: cloudflare({
    // Keep Cloudflare Images opt-in. The adapter otherwise auto-provisions an
    // IMAGES binding even though minshop stores and serves originals from R2.
    ...cloudflareAdapterOptions,
  }),
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "#theme": theme.dir,
        // The per-theme stylesheet this process compiles. Selection by alias is
        // the point: the files on disk never change per process, only which
        // one global.css's @import resolves to. Tailwind v4's plugin follows
        // Vite aliases in CSS @import (probed before relying on it).
        "#theme-css": themeCssPath(theme.id),
      },
    },
  },
});
