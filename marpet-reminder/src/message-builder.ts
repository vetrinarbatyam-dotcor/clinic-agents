/**
 * message-builder.ts
 * Builds the WhatsApp message from template + variables.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EligibleVaccine } from './eligibility-logic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

function loadTemplate(name: string): string {
  try {
    return readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf-8').trim();
  } catch {
    return readFileSync(join(TEMPLATES_DIR, 'default.txt'), 'utf-8').trim();
  }
}

export function buildMessage(params: {
  ownerName: string;
  petName: string;
  eligibleVaccines: EligibleVaccine[];
  templateOverride?: string;
}): string {
  const { ownerName, petName, eligibleVaccines, templateOverride } = params;

  const template = templateOverride || loadTemplate('default');

  // Build vaccine list
  const vaccineLines = eligibleVaccines
    .filter(v => v.petName === petName)
    .map(v => {
      if (v.eligible) return v.vaccineName;
      return `${v.vaccineName} (זמין מ-${v.nextDate})`;
    });

  const vaccineList = vaccineLines.join(', ');

  // First name only
  const firstName = ownerName.split(' ')[0] || ownerName;

  return template
    .replace(/\{שם_בעלים\}/g, firstName)
    .replace(/\{שם_חיה\}/g, petName)
    .replace(/\{רשימת_חיסונים_זכאים\}/g, vaccineList)
    .replace(/\{מספר_מרפאה\}/g, '03-5513649');
}

export function buildMultiPetMessage(params: {
  ownerName: string;
  eligibleVaccines: EligibleVaccine[];
  templateOverride?: string;
}): string {
  const { ownerName, eligibleVaccines, templateOverride } = params;

  // Group by pet
  const byPet = new Map<string, string[]>();
  for (const v of eligibleVaccines) {
    const list = byPet.get(v.petName) || [];
    if (v.eligible) {
      list.push(v.vaccineName);
    } else {
      list.push(`${v.vaccineName} (זמין מ-${v.nextDate})`);
    }
    byPet.set(v.petName, list);
  }

  const petLines = [...byPet.entries()]
    .map(([petName, vaccines]) => `• ${petName}: ${vaccines.join(', ')}`)
    .join('\n');

  const firstName = ownerName.split(' ')[0] || ownerName;

  const template = templateOverride || `היי {שם_בעלים} 🐾\nזאת תזכורת מהמרכז הווטרינרי של ד״ר גיל קרן.\n\nמגיע לחיות שלך דרך מרפט:\n{רשימת_חיסונים_זכאים}\n\nנשמח לראות אתכם לקביעת תור 📞 https://wa.me/972535513649`;

  return template
    .replace(/\{שם_בעלים\}/g, firstName)
    .replace(/\{רשימת_חיסונים_זכאים\}/g, petLines)
    .replace(/\{מספר_מרפאה\}/g, '03-5513649');
}
