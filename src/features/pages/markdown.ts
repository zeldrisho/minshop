import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItInstance, Token } from "markdown-it";
import { mediaUrl } from "../media/url.ts";

/**
 * Server-only Markdown renderer, shared by the storefront route and the admin
 * preview endpoint so the two cannot drift. It is never bundled for the browser:
 * the editor's Preview tab posts to /api/admin/pages/preview and renders what
 * this returns.
 *
 * `html: false` is the whole safety model. Raw HTML in a page body is escaped
 * rather than parsed, so an admin cannot inject a <script>, an iframe, or an
 * event handler — and neither can anyone who gets hold of an admin session.
 * markdown-it also validates link targets against its own scheme blocklist
 * (javascript:, vbscript:, file:, and data: except for images), so we do not
 * hand-roll URL filtering.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

/** Root-relative media reference the editor inserts: /images/<key>. */
const LOCAL_IMAGE_PREFIX = "/images/";

/**
 * Extracts a local media key from a root-relative or configured-base image URL.
 *
 * @param src - The image URL to inspect
 * @param baseUrl - The configured base URL for images
 * @returns The media key, or `null` when the URL does not identify a local image
 */
function localKeyFromSrc(src: string, baseUrl: string): string | null {
  if (src.startsWith(LOCAL_IMAGE_PREFIX)) {
    return src.slice(LOCAL_IMAGE_PREFIX.length) || null;
  }
  // Absolute form, in case a body was pasted from a store with IMAGE_BASE_URL
  // set. The editor only ever writes the root-relative form.
  if (baseUrl && src.startsWith(`${baseUrl}/`)) {
    return src.slice(baseUrl.length + 1) || null;
  }
  return null;
}

/**
 * Extracts plain text from inline tokens for use as image alt text.
 *
 * @param tokens - Inline tokens whose textual content should be combined
 * @returns The combined text, including escaped characters and inline code
 */
function inlineTextOf(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "text" || token.type === "text_special") return token.content;
      if (token.type === "code_inline") return token.content;
      if (token.children?.length) return inlineTextOf(token.children);
      return "";
    })
    .join("");
}

export interface RenderOptions {
  /** config.images.baseUrl — lets page images use a custom image origin. */
  baseUrl?: string;
  /**
   * Emit `data-source-line` on block elements. Admin preview only — it lets a
   * click in the preview jump to the matching line in the editor. The public
   * page renders without it, so storefront HTML stays free of editor plumbing.
   */
  sourceMap?: boolean;
  /**
   * Pixel dimensions per media key, so each <img> can reserve its space.
   *
   * Without width/height an image has no intrinsic size and no aspect-ratio, so
   * it occupies only its alt-text line box until the bitmap arrives and then
   * jumps to full height — 181px of shift on a 242x209 page image. Keys absent
   * from the map simply render without the attributes, which is the old
   * behaviour, so a page mixing measured and unmeasured images still works.
   */
  dimensions?: Map<string, { width: number; height: number }>;
}

/**
 * Configures image rendering for local media URLs, accessibility text, loading behavior, and optional intrinsic dimensions.
 *
 * @param baseUrl - Base URL used to resolve local image keys.
 * @param dimensions - Optional intrinsic dimensions keyed by local image key.
 */
function installImageRule(
  instance: MarkdownItInstance,
  baseUrl: string,
  dimensions?: RenderOptions["dimensions"],
): void {
  instance.renderer.rules.image = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    // attrGet is typed string | number since markdown-it 15; src is always a string.
    const src = String(token.attrGet("src") ?? "");
    const key = localKeyFromSrc(src, baseUrl);
    if (key) token.attrSet("src", mediaUrl(key, baseUrl));
    // markdown-it's DEFAULT image rule fills `alt` from the token's inline
    // children; overriding the rule means doing it here too. Without this every
    // image renders alt="" — the alt text an author typed is silently dropped.
    token.attrSet("alt", inlineTextOf(token.children ?? []));
    // Body images are below the fold by definition — the header logo is the
    // only image on the page that must not be lazy.
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
    const size = key ? dimensions?.get(key) : undefined;
    if (size) {
      // Intrinsic size only. The CSS keeps `max-width: 100%; height: auto`, so
      // these reserve the right aspect ratio without pinning the rendered size.
      token.attrSet("width", String(size.width));
      token.attrSet("height", String(size.height));
    }
    // renderToken escapes attribute values, and alt text goes through the
    // default renderer, so neither can break out into markup.
    return self.renderToken(tokens, idx, options);
  };
}

/**
 * Renders Markdown to HTML with configured image handling and optional source mapping.
 *
 * @param markdown - The Markdown content to render
 * @param options - Rendering options, including image URL rewriting, dimensions, and source-map attributes
 * @returns The rendered HTML
 */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const baseUrl = options.baseUrl ?? "";
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  installImageRule(instance, baseUrl, options.dimensions);

  if (options.sourceMap) {
    // Block tokens carry `map: [startLine, endLine]`. Stamping the start line on
    // the opening tag is all the editor needs to map a click back to the source;
    // inline tokens have no map, so images inherit their block's line.
    const renderToken = instance.renderer.renderToken.bind(instance.renderer);
    instance.renderer.renderToken = (tokens, idx, opts) => {
      const token = tokens[idx];
      if (token.map && token.nesting !== -1) {
        token.attrSet("data-source-line", String(token.map[0] + 1));
        // Exclusive end line, so the editor knows the block's source extent and
        // can map a click INSIDE the text to a character offset rather than
        // selecting the whole line.
        token.attrSet("data-source-end", String(token.map[1] + 1));
      }
      return renderToken(tokens, idx, opts);
    };
  }

  return instance.render(markdown);
}

/**
 * Creates a plain-text excerpt from Markdown for use as a description.
 *
 * @param markdown - The Markdown source to summarize
 * @param maxLength - The maximum length of the resulting excerpt
 * @returns The normalized Markdown text, truncated at a word boundary with an ellipsis when necessary
 */
export function markdownExcerpt(markdown: string, maxLength = 160): string {
  const text = md
    .parse(markdown, {})
    .filter((token) => token.type === "inline")
    .map((token) =>
      (token.children ?? [])
        .filter((child) => child.type === "text" || child.type === "code_inline")
        .map((child) => child.content)
        .join(""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  // Cut on a word boundary so the summary doesn't end mid-word.
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Extracts distinct local media keys referenced by Markdown.
 *
 * @param options - Rendering options used to identify local image URLs
 * @returns Local media keys in first-reference order
 */
export function extractMediaKeys(markdown: string, options: RenderOptions = {}): string[] {
  const baseUrl = options.baseUrl ?? "";
  const keys = new Set<string>();
  const walk = (tokens: ReturnType<typeof md.parse>) => {
    for (const token of tokens) {
      if (token.type === "image") {
        const key = localKeyFromSrc(String(token.attrGet("src") ?? ""), baseUrl);
        if (key) keys.add(key);
      }
      if (token.children?.length) walk(token.children);
    }
  };
  walk(md.parse(markdown, {}));
  // A Set keeps insertion order, so repeated references collapse to one entry
  // and page_media never gets a duplicate row.
  return [...keys];
}
