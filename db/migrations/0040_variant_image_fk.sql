-- 0040: enforce product_variants.image_id integrity (contract for 0018).
--
-- 0018 added image_id as a plain column with the ownership rule living only in
-- admin form validation, so dangling references (image deleted) and
-- cross-product references (image from another product) could persist. D1 does
-- enforce declared foreign keys, so this migration rebuilds the table with:
--   FOREIGN KEY (image_id) REFERENCES product_images(id) ON DELETE SET NULL
-- and adds database-level ownership triggers, because a simple foreign key
-- cannot require the referenced image's product_id to match the variant's
-- product_id. The composite alternative (product_id, image_id) →
-- product_images(product_id, id) is deliberately NOT used with ON DELETE SET
-- NULL: deleting an image would null both columns, wiping the variant's
-- required product_id.
--
-- Rebuild is safe here: fresh databases have no rows yet, and databases that
-- applied the pre-FK 0017 carry no order_items.variant_id foreign key into
-- this table, so dropping/recreating product_variants trips nothing.
-- Trigger bodies use SELECT RAISE(ABORT, …) WHERE EXISTS (…) — see 0039 for
-- why CASE…END inside a trigger body breaks `wrangler d1 migrations apply
-- --remote`.

-- Clean existing invalid references first, so every row copied below satisfies
-- the new foreign key.
UPDATE product_variants SET image_id = NULL
WHERE image_id IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM product_images pi WHERE pi.id = product_variants.image_id
    )
    OR EXISTS (
      SELECT 1 FROM product_images pi
      WHERE pi.id = product_variants.image_id
        AND pi.product_id <> product_variants.product_id
    )
  );

CREATE TABLE product_variants_rebuilt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  label        TEXT    NOT NULL,
  price_cents  INTEGER NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  sku          TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  weight_grams INTEGER,
  public_id    TEXT,
  image_id     INTEGER REFERENCES product_images(id) ON DELETE SET NULL
);

INSERT INTO product_variants_rebuilt
  (id, product_id, label, price_cents, stock, sku, position, active,
   weight_grams, public_id, image_id)
SELECT id, product_id, label, price_cents, stock, sku, position, active,
       weight_grams, public_id, image_id
FROM product_variants;

DROP TABLE product_variants;
ALTER TABLE product_variants_rebuilt RENAME TO product_variants;

-- Indexes dropped with the old table (explicit names survive a rename only if
-- recreated; recreate rather than rely on either behavior).
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_public_id
ON product_variants(public_id) WHERE public_id IS NOT NULL;

-- Ownership rule the foreign key cannot express: a variant may only reference
-- one of its OWN product's gallery images.
CREATE TRIGGER IF NOT EXISTS trg_variant_image_owner_insert
BEFORE INSERT ON product_variants
WHEN NEW.image_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'variant image must belong to the same product')
   WHERE EXISTS (
     SELECT 1 FROM product_images pi
     WHERE pi.id = NEW.image_id AND pi.product_id <> NEW.product_id
   );
END;

CREATE TRIGGER IF NOT EXISTS trg_variant_image_owner_update
BEFORE UPDATE OF image_id, product_id ON product_variants
WHEN NEW.image_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'variant image must belong to the same product')
   WHERE EXISTS (
     SELECT 1 FROM product_images pi
     WHERE pi.id = NEW.image_id AND pi.product_id <> NEW.product_id
   );
END;
