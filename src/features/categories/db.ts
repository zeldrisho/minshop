import type { D1Database } from "@cloudflare/workers-types";
import type { Product } from "../products/db";
import { withPublicId } from "../ids/publicId.ts";

export interface Category {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  public_id: string | null;
  created_at: string;
}

export interface CategoryNode extends Category {
  depth: number;
  children: CategoryNode[];
}

/** A depth-tagged flat row, for indented <select> options / checkboxes. */
export interface CategoryOption {
  id: number;
  public_id: string | null;
  name: string;
  slug: string;
  depth: number;
}

export interface CategoryFields {
  name: string;
  slug: string;
  parent_id: number | null;
}

/**
 * Lists all categories in alphabetical order by name.
 *
 * @returns The matching categories, or an empty array when no categories exist.
 */
export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db.prepare("SELECT * FROM categories ORDER BY name").all<Category>();
  return results ?? [];
}

/**
 * Retrieves a category by its numeric ID.
 *
 * @param id - The category's numeric ID
 * @returns The matching category, or `null` when no category is found
 */
export async function getCategory(db: D1Database, id: number): Promise<Category | null> {
  return db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<Category>();
}

/**
 * Retrieves a category by its slug.
 *
 * @param slug - The category slug to search for
 * @returns The matching category, or `null` if no category has the slug
 */
export async function getCategoryBySlug(db: D1Database, slug: string): Promise<Category | null> {
  return db.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first<Category>();
}

/**
 * Retrieves a category by its prefixed public ID.
 *
 * @param publicId - The category's prefixed public identifier
 * @returns The matching category, or `null` if no category exists with that ID
 */
export async function getCategoryByPublicId(
  db: D1Database,
  publicId: string,
): Promise<Category | null> {
  return db
    .prepare("SELECT * FROM categories WHERE public_id = ?")
    .bind(publicId)
    .first<Category>();
}

/** Categories for many public IDs in one boundary-resolution read. */
export async function getCategoriesByPublicIds(
  db: D1Database,
  publicIds: string[],
): Promise<Category[]> {
  if (publicIds.length === 0) return [];
  const placeholders = publicIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE public_id IN (${placeholders})`)
    .bind(...publicIds)
    .all<Category>();
  return results ?? [];
}

/**
 * Creates a category with a generated public ID.
 *
 * @param c - The category fields to store
 * @returns The database ID of the created category
 */
export async function createCategory(db: D1Database, c: CategoryFields): Promise<number> {
  return withPublicId("category", async (publicId) => {
    const row = await db
      .prepare(
        "INSERT INTO categories (name, slug, parent_id, public_id) VALUES (?, ?, ?, ?) RETURNING id",
      )
      .bind(c.name, c.slug, c.parent_id, publicId)
      .first<{ id: number }>();
    return row!.id;
  });
}

/**
 * Updates the name, slug, and parent category of a category.
 *
 * @param id - The numeric ID of the category to update
 * @param c - The category fields to save
 */
export async function updateCategory(db: D1Database, id: number, c: CategoryFields): Promise<void> {
  await db
    .prepare("UPDATE categories SET name = ?, slug = ?, parent_id = ? WHERE id = ?")
    .bind(c.name, c.slug, c.parent_id, id)
    .run();
}

/**
 * Deletes a category and preserves the category hierarchy by reparenting its direct children.
 */
export async function deleteCategory(db: D1Database, id: number): Promise<void> {
  const cat = await getCategory(db, id);
  if (!cat) return;
  await db.batch([
    db.prepare("UPDATE categories SET parent_id = ? WHERE parent_id = ?").bind(cat.parent_id, id),
    db.prepare("DELETE FROM product_categories WHERE category_id = ?").bind(id),
    db.prepare("DELETE FROM categories WHERE id = ?").bind(id),
  ]);
}

/** All descendant ids of a category, including itself (recursive CTE). */
export async function descendantIds(db: D1Database, id: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT id FROM sub`,
    )
    .bind(id)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Ancestor chain from root down to the category itself (for breadcrumbs). */
export async function ancestors(db: D1Database, id: number): Promise<Category[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id, name, slug, parent_id, created_at, depth) AS (
         SELECT id, name, slug, parent_id, created_at, 0 FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id, c.name, c.slug, c.parent_id, c.created_at, up.depth + 1
         FROM categories c JOIN up ON c.id = up.parent_id
       )
       SELECT id, name, slug, parent_id, created_at FROM up ORDER BY depth DESC`,
    )
    .bind(id)
    .all<Category>();
  return results ?? [];
}

/**
 * Counts products assigned directly to each category.
 *
 * @returns A map from category ID to its direct product count.
 */
export async function productCounts(db: D1Database): Promise<Map<number, number>> {
  const { results } = await db
    .prepare("SELECT category_id, COUNT(*) AS n FROM product_categories GROUP BY category_id")
    .all<{ category_id: number; n: number }>();
  const counts = new Map<number, number>();
  for (const r of results ?? []) counts.set(r.category_id, r.n);
  return counts;
}

/** Categories assigned to a product. */
export async function categoriesForProduct(db: D1Database, productId: number): Promise<Category[]> {
  const { results } = await db
    .prepare(
      `SELECT c.* FROM categories c
       JOIN product_categories pc ON pc.category_id = c.id
       WHERE pc.product_id = ? ORDER BY c.name`,
    )
    .bind(productId)
    .all<Category>();
  return results ?? [];
}

/**
 * Loads categories assigned to multiple products.
 *
 * @param productIds - Product IDs to look up; duplicate and non-integer IDs are ignored.
 * @returns A map from each valid product ID to its assigned categories, including empty arrays for products without categories.
 */
export async function categoriesForProducts(
  db: D1Database,
  productIds: number[],
): Promise<Map<number, Category[]>> {
  const ids = [...new Set(productIds.filter(Number.isInteger))];
  const byProduct = new Map<number, Category[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byProduct;

  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT pc.product_id,
              c.id, c.name, c.slug, c.parent_id, c.created_at
         FROM product_categories pc
         JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id IN (${placeholders})
        ORDER BY pc.product_id, c.name`,
    )
    .bind(...ids)
    .all<Category & { product_id: number }>();

  for (const { product_id, ...category } of results ?? []) {
    byProduct.get(product_id)?.push(category);
  }
  return byProduct;
}

/** Active products sharing a category with the given product (excludes itself). */
export async function relatedProducts(
  db: D1Database,
  productId: number,
  limit = 4,
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.* FROM products p
         JOIN product_categories pc ON pc.product_id = p.id
        WHERE pc.category_id IN (
                SELECT category_id FROM product_categories WHERE product_id = ?1
              )
          AND p.id != ?1 AND p.active = 1
        ORDER BY p.created_at DESC
        LIMIT ?2`,
    )
    .bind(productId, limit)
    .all<Product>();
  return results ?? [];
}

/**
 * Finds the newest active products that share at least one category with the specified products.
 *
 * @param productIds - IDs of the source products whose categories determine the results
 * @param limit - Maximum number of products to return
 * @returns Active products ordered from newest to oldest, excluding the source products
 */
export async function productsInSharedCategories(
  db: D1Database,
  productIds: number[],
  limit: number,
): Promise<Product[]> {
  if (productIds.length === 0 || limit <= 0) return [];
  const ph = productIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.* FROM products p
         JOIN product_categories pc ON pc.product_id = p.id
        WHERE pc.category_id IN (
                SELECT category_id FROM product_categories WHERE product_id IN (${ph})
              )
          AND p.id NOT IN (${ph})
          AND p.active = 1
        ORDER BY p.created_at DESC
        LIMIT ?`,
    )
    .bind(...productIds, ...productIds, limit)
    .all<Product>();
  return results ?? [];
}

/** Replace a product's category links with the given set. */
export async function setProductCategories(
  db: D1Database,
  productId: number,
  categoryIds: number[],
): Promise<void> {
  const stmts = [
    db.prepare("DELETE FROM product_categories WHERE product_id = ?").bind(productId),
    ...categoryIds.map((cid) =>
      db
        .prepare("INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)")
        .bind(productId, cid),
    ),
  ];
  await db.batch(stmts);
}

/** A page of active products in a category, including descendant categories. */
export async function productsInCategory(
  db: D1Database,
  categoryId: number,
  limit: number,
  offset = 0,
  orderBy = "created_at DESC",
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT DISTINCT p.* FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
       WHERE pc.category_id IN (SELECT id FROM sub) AND p.active = 1
       ORDER BY ${orderBy}
       LIMIT ?2 OFFSET ?3`,
    )
    .bind(categoryId, limit, offset)
    .all<Product>();
  return results ?? [];
}

/**
 * Counts active products assigned to a category or any of its descendants.
 *
 * @param categoryId - The category whose subtree is counted
 * @returns The number of distinct active products in the category subtree
 */
export async function countProductsInCategory(db: D1Database, categoryId: number): Promise<number> {
  const row = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT COUNT(DISTINCT p.id) AS n FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
       WHERE pc.category_id IN (SELECT id FROM sub) AND p.active = 1`,
    )
    .bind(categoryId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Direct children of a category (or top-level when parentId is null). */
export function childrenOf(cats: Category[], parentId: number | null): Category[] {
  return cats.filter((c) => c.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** Build a nested tree from the flat list. */
export function buildTree(cats: Category[]): CategoryNode[] {
  const byId = new Map<number, CategoryNode>();
  cats.forEach((c) => byId.set(c.id, { ...c, depth: 0, children: [] }));
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: CategoryNode[], depth: number) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
  };
  sortRec(roots, 0);
  return roots;
}

/** Flatten a tree to depth-tagged options (pre-order) for selects/checkboxes. */
export function flattenTree(nodes: CategoryNode[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (ns: CategoryNode[]) => {
    for (const n of ns) {
      out.push({ id: n.id, public_id: n.public_id, name: n.name, slug: n.slug, depth: n.depth });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
