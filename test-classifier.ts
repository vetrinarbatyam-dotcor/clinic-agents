import 'dotenv/config';
import { getVisitsForDate } from './shared/clinica';
import { classifyVisit } from './followup-agents/src/classifier';

const visits = await getVisitsForDate('04/05/2026');

const results = { medical: 0, 'new-client': 0, surgery: 0, skipped: 0 };
const medicals: string[] = [];
const skipped: string[] = [];

for (const v of visits) {
  const c = await classifyVisit(v);
  if (!c) {
    results.skipped++;
    const items = v.items.map((it: any) => it.FieldName || '').filter(Boolean).join(', ');
    skipped.push(`${v.ownerName} (${v.petName}) — ${v.vaccineName || items || '(ריק)'}`);
    continue;
  }
  results[c.category]++;
  if (c.category === 'medical') {
    const items = v.items.map((it: any) => it.FieldName || '').filter(Boolean).join(', ');
    medicals.push(`${v.ownerName} (${v.petName}) — ${v.finds?.slice(0, 60) || items.slice(0, 60) || '(items only)'}`);
  }
}

console.log('\n=== RESULTS ===');
console.log(`Medical: ${results.medical}`);
console.log(`New client: ${results['new-client']}`);
console.log(`Surgery: ${results.surgery}`);
console.log(`Skipped: ${results.skipped}`);
console.log(`Total follow-up: ${results.medical + results['new-client'] + results.surgery}`);

console.log('\n=== MEDICAL (follow-up) ===');
medicals.forEach((m, i) => console.log(`${i + 1}. ${m}`));

console.log('\n=== SKIPPED ===');
skipped.forEach((s, i) => console.log(`${i + 1}. ${s}`));
