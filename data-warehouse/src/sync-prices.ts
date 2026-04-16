#!/usr/bin/env bun
/**
 * Sync ClinicaOnline price list → PostgreSQL catalog_items + price_history.
 * Runs on Contabo as part of clinic-agents.
 *
 * Usage:
 *   bun run sync-prices.ts              # Full sync all tabs
 *   bun run sync-prices.ts --search סימפריקה  # Sync specific items
 */
import 'dotenv/config';
import { pool } from '../../shared/db';
import { callAsmx } from '../../shared/clinica.ts';

interface PriceItem {
  FieldID: string;
  FieldName: string;
  FieldValue: string;
  Type: number;
  SectionID: number;
  FullPath: string;
  IsInventory: boolean;
  InventoryAmount: number;
  MinAmount: number;
  IsStandingOrder: number;
  Frequency: number;
  Alert: number;
}

// ============ Fetch all prices from ClinicaOnline ============

async function fetchAllPrices(): Promise<PriceItem[]> {
  const allItems = new Map<string, PriceItem>();

  // Load all tabs (1-7)
  for (let tab = 1; tab <= 7; tab++) {
    try {
      const items = await callAsmx('LoadPriceList', { TabNumber: tab });
      if (Array.isArray(items)) {
        for (const item of items) {
          const fid = String(item.FieldID || '');
          if (!fid) continue;
          if (!allItems.has(fid)) {
            allItems.set(fid, {
              FieldID: fid,
              FieldName: item.FieldName || '',
              FieldValue: item.FieldValue || '0',
              Type: item.Type || 0,
              SectionID: item.SectionID || 0,
              FullPath: item.FullPath || '',
              IsInventory: item.IsInventory || false,
              InventoryAmount: item.InventoryAmount || 0,
              MinAmount: item.MinAmount || 0,
              IsStandingOrder: item.IsStandingOrder || 0,
              Frequency: item.Frequency || 0,
              Alert: item.Alert || 0,
            });
          } else {
            allItems.get(fid)!.FieldValue = item.FieldValue || '0';
          }
        }
        console.log(`  Tab ${tab}: ${items.length} items`);
      }
    } catch (e: any) {
      console.error(`  Tab ${tab}: ERROR - ${e.message}`);
    }
  }

  console.log(`\nTotal unique items from tabs: ${allItems.size}`);

  // Enrich with names via SearchPriceItem
  const searchTerms = [
    'בדיקה', 'חיסון', 'ניתוח', 'אולטרסאונד', 'רנטגן', 'סימפריקה', 'ברווקטו',
    'נקסגארד', 'רויאל', 'הילס', 'פרו פלאן', 'אדוונטיקס', 'סרסטו',
    'דם', 'שתן', 'צילום', 'הרדמה', 'עיקור', 'סירוס', 'אשפוז',
    'זריקה', 'תרופ', 'אנטיביוטיקה', 'כלבת', 'משושה', 'מרובע',
    'ציפורן', 'שיניים', 'עיניים', 'אוזניים', 'עור', 'מזון',
    'פרעוש', 'קרציות', 'תולע', 'גירוד', 'פצע', 'תפירה',
  ];

  let enriched = 0;
  for (const term of searchTerms) {
    try {
      const results = await callAsmx('SearchPriceItem', { Barcod: 0, str: term });
      if (Array.isArray(results)) {
        for (const item of results) {
          const fid = String(item.FieldID || '');
          if (!fid) continue;
          if (allItems.has(fid)) {
            const existing = allItems.get(fid)!;
            if (item.FieldName) existing.FieldName = item.FieldName;
            if (item.FullPath) existing.FullPath = item.FullPath;
            if (item.SectionID) existing.SectionID = item.SectionID;
            if (item.Type) existing.Type = item.Type;
          } else {
            allItems.set(fid, {
              FieldID: fid,
              FieldName: item.FieldName || '',
              FieldValue: item.FieldValue || '0',
              Type: item.Type || 0,
              SectionID: item.SectionID || 0,
              FullPath: item.FullPath || '',
              IsInventory: item.IsInventory || false,
              InventoryAmount: item.InventoryAmount || 0,
              MinAmount: item.MinAmount || 0,
              IsStandingOrder: item.IsStandingOrder || 0,
              Frequency: item.Frequency || 0,
              Alert: item.Alert || 0,
            });
            enriched++;
          }
        }
      }
    } catch (e: any) {
      console.error(`  Search '${term}': ERROR - ${e.message}`);
    }
  }

  console.log(`Enriched ${enriched} additional items via search`);
  console.log(`Total items: ${allItems.size}`);
  return Array.from(allItems.values());
}

async function searchPrices(term: string): Promise<PriceItem[]> {
  const results = await callAsmx('SearchPriceItem', { Barcod: 0, str: term });
  return Array.isArray(results) ? results : [];
}

// ============ Sync to DB ============

async function syncToDb(items: PriceItem[]): Promise<{ added: number; updated: number; priceChanges: number }> {
  let added = 0, updated = 0, priceChanges = 0;

  for (const item of items) {
    const fieldId = parseInt(item.FieldID);
    const name = item.FieldName || '';
    const price = parseFloat(item.FieldValue) || 0;
    const fullPath = item.FullPath || '';
    const category = fullPath.split('/')[0]?.trim() || '';

    // Check if exists
    const { rows: existing } = await pool.query(
      'SELECT id, price FROM catalog_items WHERE field_id = $1', [fieldId]
    );

    if (existing.length > 0) {
      const oldPrice = parseFloat(existing[0].price) || 0;

      await pool.query(`
        UPDATE catalog_items SET
          name = COALESCE(NULLIF($1, ''), name),
          category = COALESCE(NULLIF($2, ''), category),
          price = $3,
          full_path = COALESCE(NULLIF($4, ''), full_path),
          section_id = $5, item_type = $6,
          is_inventory = $7, inventory_amount = $8,
          min_amount = $9, is_standing_order = $10,
          frequency = $11, alert = $12,
          updated_at = NOW()
        WHERE field_id = $13
      `, [name, category, price, fullPath,
          item.SectionID, item.Type,
          item.IsInventory, item.InventoryAmount,
          item.MinAmount, item.IsStandingOrder,
          item.Frequency, item.Alert, fieldId]);
      updated++;

      // Log price change
      if (oldPrice !== price && price > 0) {
        await pool.query(`
          INSERT INTO price_history (field_id, item_name, old_price, new_price, changed_by)
          VALUES ($1, $2, $3, $4, 'sync')
        `, [fieldId, name, oldPrice, price]);
        priceChanges++;
      }
    } else {
      await pool.query(`
        INSERT INTO catalog_items
          (name, category, price, field_id, full_path, section_id, item_type,
           is_inventory, inventory_amount, min_amount, is_standing_order,
           frequency, alert, active, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NOW())
      `, [name, category, price, fieldId, fullPath,
          item.SectionID, item.Type,
          item.IsInventory, item.InventoryAmount,
          item.MinAmount, item.IsStandingOrder,
          item.Frequency, item.Alert]);
      added++;

      if (price > 0) {
        await pool.query(`
          INSERT INTO price_history (field_id, item_name, old_price, new_price, changed_by)
          VALUES ($1, $2, NULL, $3, 'initial_sync')
        `, [fieldId, name, price]);
      }
    }
  }

  return { added, updated, priceChanges };
}

async function backfillVisitItemsCategories(): Promise<number> {
  const { rowCount } = await pool.query(`
    UPDATE visit_items vi
    SET category = ci.category
    FROM catalog_items ci
    WHERE vi.field_id = ci.field_id
      AND (vi.category IS NULL OR vi.category = '')
      AND ci.category IS NOT NULL AND ci.category != ''
  `);
  return rowCount || 0;
}

// ============ Main ============

async function main() {
  const searchArg = process.argv.find(a => a === '--search');
  const searchTerm = searchArg ? process.argv[process.argv.indexOf(searchArg) + 1] : null;

  console.log(`=== Price Sync ${new Date().toISOString().slice(0, 16)} ===\n`);

  let items: PriceItem[];
  if (searchTerm) {
    console.log(`Searching for: ${searchTerm}`);
    items = await searchPrices(searchTerm);
    console.log(`Found ${items.length} items`);
  } else {
    console.log('Fetching full price list...');
    items = await fetchAllPrices();
  }

  if (items.length === 0) {
    console.log('No items to sync!');
    process.exit(0);
  }

  console.log('\nSyncing to catalog_items...');
  const result = await syncToDb(items);
  console.log(`  Added: ${result.added}`);
  console.log(`  Updated: ${result.updated}`);
  console.log(`  Price changes logged: ${result.priceChanges}`);

  console.log('\nBackfilling visit_items categories...');
  const backfilled = await backfillVisitItemsCategories();
  console.log(`  Updated ${backfilled} visit_items with categories`);

  await pool.end();
  console.log('\nDone!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
