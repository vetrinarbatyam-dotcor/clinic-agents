const HEB_DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
export function formatHebrewDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}
export function getHebrewDayName(d: Date): string {
  return HEB_DAYS[d.getDay()];
}
export function fillTemplate(tpl: string, vars: Record<string,string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
