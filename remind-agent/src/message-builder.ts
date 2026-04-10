import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { GroupedReminder } from './vaccine-scanner';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

function loadTemplate(name: string): string {
  try {
    return readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf-8');
  } catch {
    return 'היי {ownerName}! 🐾\nמרפאת פט קייר מזכירה: {petName} צריך/ה לחדש חיסון ({vaccineType}).\nנשמח לתאם ביקור! 💉';
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === '1/1/1900') return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('he-IL');
  } catch {
    return dateStr;
  }
}

export function buildMessage(reminder: GroupedReminder, category: 'vaccine-expired' | 'deep-scan'): string {
  const totalVaccines = reminder.pets.reduce((sum, p) => sum + p.vaccines.length, 0);
  const isMulti = totalVaccines > 1;

  if (category === 'deep-scan') {
    // Deep scan always uses the deep template
    const template = loadTemplate('vaccine-reminder-deep');
    const lines: string[] = [];
    for (const pet of reminder.pets) {
      for (const vac of pet.vaccines) {
        lines.push(`• ${pet.petName} — ${vac.vacName}`);
      }
    }
    return template
      .replace(/{ownerName}/g, reminder.ownerName)
      .replace(/{petName}/g, reminder.pets[0]?.petName || '')
      .replace(/{vaccineList}/g, lines.join('\n'));
  }

  // Regular vaccine-expired
  if (isMulti) {
    const template = loadTemplate('vaccine-reminder-multi');
    const lines: string[] = [];
    for (const pet of reminder.pets) {
      for (const vac of pet.vaccines) {
        lines.push(`• ${pet.petName} — ${vac.vacName}`);
      }
    }
    return template
      .replace(/{ownerName}/g, reminder.ownerName)
      .replace(/{vaccineList}/g, lines.join('\n'));
  }

  // Single vaccine
  const pet = reminder.pets[0];
  const vac = pet.vaccines[0];
  const template = loadTemplate('vaccine-reminder');
  const lastDate = formatDate(vac.lastDate);

  return template
    .replace(/{ownerName}/g, reminder.ownerName)
    .replace(/{petName}/g, pet.petName)
    .replace(/{vaccineType}/g, vac.vacName)
    .replace(/{lastDate}/g, lastDate || 'לא ידוע');
}
