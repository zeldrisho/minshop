-- 0002: product slugs for public URLs. `id` stays the internal key (cart,
-- order_items, admin, checkout); `slug` is only the storefront URL. Additive.

ALTER TABLE products ADD COLUMN slug TEXT;

-- Backfill existing rows with a basic slug from the name (lowercase, spaces →
-- dashes, drop a few punctuation marks). Good enough for seeded/simple names;
-- the app generates clean unique slugs going forward.
UPDATE products
SET slug = lower(replace(replace(replace(replace(name, ' ', '-'), '''', ''), '.', ''), ',', ''))
WHERE slug IS NULL OR slug = '';

-- The naive backfill is not injective: "A B" and "a-b" both normalize to
-- "a-b", and the unique index below would abort the whole migration. Resolve
-- normalized collisions deterministically BEFORE the index exists: within each
-- colliding group the lowest rowid keeps its slug, every other row gets a
-- stable positional suffix (-2, -3, …). Unique slugs are left untouched. A
-- suffixed value can only re-collide if another product already backfilled to
-- exactly "<slug>-<n>" — not possible for the controlled seed names this
-- backfill targets, and impossible for app-generated slugs created later.
UPDATE products
   SET slug = products.slug || '-' || ranked.rn
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY slug ORDER BY id) AS rn
      FROM products
     WHERE slug IN (SELECT slug FROM products GROUP BY slug HAVING COUNT(*) > 1)
  ) AS ranked
 WHERE products.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
