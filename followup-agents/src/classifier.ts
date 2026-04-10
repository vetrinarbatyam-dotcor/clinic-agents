import type { VisitCategory } from '../../shared/types';
import type { SessionVisit } from '../../shared/clinica';
import { getPetDetails, getPetSessions, getClientRegistrationDate } from '../../shared/clinica';

const SURGERY_KEYWORDS = [
  'ניתוח', 'סירוס', 'עיקור', 'כריתה', 'ביופסיה', 'ניקוי שיניים',
  'אורכידקטומי', 'לפרוטומי', 'לפרוסקופ', 'הרדמה', 'הסרת מסות',
  'OVH', 'OVE', 'surgery', 'spay', 'neuter', 'castrat',
];

const FIRST_VACCINE_KEYWORDS = [
  'משושה', 'DP', 'חיסון ראשון', 'חיסון שני', 'puppy', 'kitten',
];

// Items that indicate a real medical visit (not just product pickup)
const MEDICAL_ITEM_KEYWORDS = [
  'בדיקה רפואית', 'בדיקה כללית',
  'בדיקת שתן', 'בדיקת דם', 'בדיקת צואה',
  'CBC', 'כימיה',
  'זריקה', 'זריקת',
  'צילום', 'צילומי',
  'אולטראסאונד', 'אולטרסאונד',
  'ריקון', 'ריקון בלוטות',
  'הסרת', 'הסרה',
  'עירוי',
  'צביעת',
  'אשפוז',
  'תפירה', 'תפירות',
  'שטיפת אוזניים',
  'ניקוי שיניים',
  'קיט',
];

export interface ClassifiedVisit {
  visit: SessionVisit;
  category: VisitCategory;
  petName: string;
  ownerName: string;
  ownerPhone: string;
  details: string;
}

function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function hasMedicalContent(visit: SessionVisit): boolean {
  return !!(visit.finds?.trim() || visit.notes?.trim());
}

function hasMedicalItems(visit: SessionVisit): boolean {
  if (!Array.isArray(visit.items) || visit.items.length === 0) return false;
  return visit.items.some((item: any) => {
    const name = (item.FieldName || item.Name || '').toLowerCase();
    return MEDICAL_ITEM_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
  });
}

function isSurgery(visit: SessionVisit): boolean {
  const text = `${visit.finds} ${visit.notes} ${visit.anamneza}`;
  if (containsKeyword(text, SURGERY_KEYWORDS)) return true;
  // Also check items for surgery-related procedures
  if (Array.isArray(visit.items)) {
    return visit.items.some((item: any) => {
      const name = (item.FieldName || item.Name || '');
      return containsKeyword(name, SURGERY_KEYWORDS);
    });
  }
  return false;
}

function isFirstVaccine(visit: SessionVisit): boolean {
  if (!visit.vaccineName) return false;
  return containsKeyword(visit.vaccineName, FIRST_VACCINE_KEYWORDS);
}

async function isNewClient(visit: SessionVisit): Promise<boolean> {
  // Check registration date
  let regDate = visit.dateOfRegistration;
  if (!regDate) {
    regDate = await getClientRegistrationDate(visit.userId);
    visit.dateOfRegistration = regDate;
  }

  if (regDate) {
    const reg = new Date(regDate);
    const visitD = new Date(visit.sessionDate);
    const diffDays = Math.abs(visitD.getTime() - reg.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 7) return true;
  }

  // Check if puppy/kitten (age < 6 months)
  try {
    const pet = await getPetDetails(visit.petId);
    if (pet?.DateBirth) {
      const birthDate = new Date(pet.DateBirth);
      const ageMonths = (Date.now() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (ageMonths <= 6) return true;
    }
  } catch {}

  // First visit ever
  try {
    const sessions = await getPetSessions(visit.petId, 730);
    if (!sessions || sessions.length <= 1) return true;
  } catch {}

  return false;
}

export async function classifyVisit(visit: SessionVisit): Promise<ClassifiedVisit | null> {
  if (!visit.ownerPhone) return null;

  let category: VisitCategory | null = null;

  // Rule 3: Surgery → always follow-up
  if (isSurgery(visit)) {
    category = 'surgery';
  }
  // Rule 1: Medical content (Finds/Notes) → follow-up
  else if (hasMedicalContent(visit)) {
    category = 'medical';
  }
  // Rule 1b: Medical items in invoice (בדיקה, זריקה, צילום...) → follow-up
  else if (hasMedicalItems(visit)) {
    category = 'medical';
  }
  // Rule 2: Vaccine only → check if first vaccine / new client
  else if (visit.vaccineName) {
    if (isFirstVaccine(visit)) {
      category = 'new-client';
    } else {
      const isNew = await isNewClient(visit);
      if (isNew) category = 'new-client';
    }
  }
  // Has items but not medical (food, products, medications) → skip
  // No items, no content, no vaccine → skip

  if (!category) return null;

  const details = [
    visit.anamneza ? `סיבה: ${visit.anamneza}` : '',
    visit.finds ? `ממצאים: ${visit.finds.slice(0, 200)}` : '',
    visit.notes ? `הוראות: ${visit.notes.slice(0, 200)}` : '',
    visit.vaccineName ? `חיסון: ${visit.vaccineName}` : '',
  ].filter(Boolean).join('\n');

  return {
    visit,
    category,
    petName: visit.petName,
    ownerName: visit.ownerName,
    ownerPhone: visit.ownerPhone,
    details,
  };
}
