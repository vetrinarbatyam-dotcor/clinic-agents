import 'dotenv/config';
import { getVisitsForDate } from './shared/clinica';
import { classifyVisit } from './followup-agents/src/classifier';

const visits = await getVisitsForDate('04/05/2026');
let i = 0;

console.log('#|לקוח|חיה|מטפל|סיבה|ממצאים|הוראות|פריטים|כמות_פריטים');

for (const v of visits) {
  const c = await classifyVisit(v);
  if (!c || c.category !== 'medical') continue;
  i++;

  const items = v.items.map((it: any) => it.FieldName || '').filter(Boolean).join(', ');
  const finds = (v.finds || '').replace(/\n/g, ' ').slice(0, 120);
  const notes = (v.notes || '').replace(/\n/g, ' ').slice(0, 120);
  const anamneza = (v.anamneza || '').replace(/\n/g, ' ').slice(0, 60);

  console.log(`${i}|${v.ownerName}|${v.petName}|${v.therapistName}|${anamneza}|${finds}|${notes}|${items}|${v.items.length}`);
}
