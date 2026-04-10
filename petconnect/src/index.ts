// PetConnect — Main Agent Entry Point
// CLI usage:
//   bun run petconnect -- --filter '{"species":"dog","minAge":8}' --message "היי {שם}, ..." --dry-run
//   bun run petconnect -- --template vaccination-reminder --filter '{"species":"cat"}' --dry-run
//   bun run petconnect:sync          # Run full data sync
//   bun run petconnect:sync:details  # Only enrich pet details

import 'dotenv/config';
import pg from 'pg';
import { filterClients, deduplicateByClient, getFilterSummary, type FilterCriteria } from './filter-engine.ts';
import { sendMessages, type SendConfig } from './message-sender.ts';
import { sendWhatsApp } from '../../shared/whatsapp.ts';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'clinicpal',
  user: process.env.DB_USER || 'clinicpal_user',
  password: process.env.DB_PASSWORD || 'clinicpal2306',
});

// Built-in message templates
const TEMPLATES: Record<string, { name: string; category: string; text: string }> = {
  'vaccination-reminder': {
    name: 'תזכורת חיסון שנתי',
    category: 'reminder',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nרצינו להזכיר שהגיע הזמן לחיסון השנתי של {שם_חיה}.\nנשמח לקבוע תור בטלפון 09-7408611.\nצוות המרפאה 💙',
  },
  'senior-checkup': {
    name: 'בדיקת דם לחיות מבוגרות',
    category: 'reminder',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\n{שם_חיה} כבר בגיל {גיל} ואנחנו ממליצים על בדיקת דם תקופתית לוודא שהכל תקין.\nלקביעת תור: 09-7408611\nצוות המרפאה 💙',
  },
  'missing-clients': {
    name: 'לקוחות שלא ביקרו',
    category: 'marketing',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nשמנו לב שלא ביקרתם אצלנו כבר תקופה.\nנשמח לראות את {שם_חיה} ולוודא שהכל בסדר.\nלקביעת תור: 09-7408611 💙',
  },
  'insurance-promo': {
    name: 'קידום ביטוח',
    category: 'marketing',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nידעת שביטוח בריאות לחיות מחמד יכול לחסוך אלפי שקלים?\nנשמח לספר ל{שם_חיה} על האפשרויות.\nלפרטים: 09-7408611 💙',
  },
  'general-update': {
    name: 'עדכון כללי',
    category: 'general',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\n{message}\nצוות המרפאה 💙',
  },
};

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].replace('--', '');
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === 'true';

  console.log('========================================');
  console.log('  PetConnect - סוכן הודעות WhatsApp');
  console.log('========================================');

  // List templates
  if (args['list-templates'] === 'true') {
    console.log('\nתבניות זמינות:');
    for (const [key, tmpl] of Object.entries(TEMPLATES)) {
      console.log(`  ${key}: ${tmpl.name} (${tmpl.category})`);
    }
    await pool.end();
    return;
  }

  // Parse filter
  let filters: FilterCriteria = {};
  if (args.filter) {
    try {
      filters = JSON.parse(args.filter);
    } catch {
      console.error('Error: --filter must be valid JSON');
      process.exit(1);
    }
  }

  // Get message
  let messageText = '';
  let category = 'general';

  if (args.template) {
    const tmpl = TEMPLATES[args.template];
    if (!tmpl) {
      console.error(`Error: template "${args.template}" not found. Use --list-templates`);
      process.exit(1);
    }
    messageText = tmpl.text;
    category = tmpl.category;
    console.log(`\nUsing template: ${tmpl.name}`);
  } else if (args.message) {
    messageText = args.message;
    category = args.category || 'general';
  } else {
    console.error('Error: provide --template <name> or --message "<text>"');
    console.error('Use --list-templates to see available templates');
    process.exit(1);
  }

  // Filter clients
  console.log('\nFilters:', JSON.stringify(filters, null, 2));
  const allClients = await filterClients(pool, filters);
  const clients = deduplicateByClient(allClients);
  const summary = getFilterSummary(clients);

  console.log('\n--- סיכום סינון ---');
  console.log(`  נמצאו: ${summary.totalClients} רשומות`);
  console.log(`  טלפונים ייחודיים: ${summary.uniquePhones}`);
  console.log(`  כלבים: ${summary.dogs} | חתולים: ${summary.cats} | אחר: ${summary.other}`);
  console.log(`  עם ביטוח: ${summary.withInsurance}`);
  if (summary.avgAge) console.log(`  גיל ממוצע: ${summary.avgAge}`);

  if (clients.length === 0) {
    console.log('\nאין לקוחות שתואמים את הפילטרים.');
    await pool.end();
    return;
  }

  // Preview first 5
  console.log('\n--- תצוגה מקדימה (5 ראשונים) ---');
  for (const c of clients.slice(0, 5)) {
    console.log(`  ${c.full_name} | ${c.pet_name} (${c.species || '?'}, ${c.breed || '?'}) | ${c.cell_phone} | ביקור: ${c.last_visit || 'N/A'}`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would send ${clients.length} messages`);

    // Show sample personalized message
    if (clients.length > 0) {
      const { personalizeMessage } = await import('./message-sender.ts');
      const sample = personalizeMessage(messageText, clients[0]);
      console.log('\n--- הודעה לדוגמה ---');
      console.log(sample);
    }

    await pool.end();
    return;
  }

  // Send
  console.log(`\nSending ${clients.length} messages...`);
  const AGENT_ID = 'petconnect';

  const result = await sendMessages(pool, clients, messageText, AGENT_ID, category, {
    dryRun: false,
    delayMs: 3000,
    maxPerWeek: 1,
  });

  console.log('\n--- תוצאות שליחה ---');
  console.log(`  נשלחו: ${result.sent}`);
  console.log(`  דולגו: ${result.skipped}`);
  console.log(`  נכשלו: ${result.failed}`);
  if (Object.keys(result.reasons).length > 0) {
    console.log('  סיבות דילוג:');
    for (const [reason, count] of Object.entries(result.reasons)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  // Send summary to Gil
  const gilPhone = '972543123419';
  const summaryMsg = `📊 פטקונקט — סיכום שליחה\n\nנשלחו: ${result.sent}\nדולגו: ${result.skipped}\nנכשלו: ${result.failed}\nקטגוריה: ${category}\nפילטרים: ${JSON.stringify(filters)}`;
  await sendWhatsApp(gilPhone, summaryMsg);
  console.log('\n[petconnect] Summary sent to Gil via WhatsApp');

  await pool.end();
}

main().catch(e => {
  console.error('[petconnect] Fatal:', e);
  process.exit(1);
});
