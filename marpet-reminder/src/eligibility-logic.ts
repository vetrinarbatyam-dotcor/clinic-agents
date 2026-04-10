/**
 * eligibility-logic.ts
 * Applies trigger mode, cooldown, and monthly cap to decide who gets a message.
 */

import { supabase } from '../../shared/supabase';
import type { PetEligibility, VaccineStatus } from './marpet-scraper';

export interface MarpetConfig {
  triggerMode: 1 | 2 | 3 | 4;  // 1=eligible now, 2=X days before, 3=both, 4=staggered
  daysBeforeEligible: number;   // for mode 2/3/4 (default 14)
  cooldownDays: number;         // per vaccine per pet (default 30)
  maxPerOwnerPerMonth: number;  // default 2
  approvalMode: 'manual' | 'auto' | 'batch-whatsapp-to-gil';
}

export const DEFAULT_CONFIG: MarpetConfig = {
  triggerMode: 1,
  daysBeforeEligible: 14,
  cooldownDays: 30,
  maxPerOwnerPerMonth: 2,
  approvalMode: 'manual',
};

export interface EligibleVaccine {
  petName: string;
  gender: string;
  breed: string;
  vaccineName: string;
  eligible: boolean;
  nextDate: string | null;
  reason: 'eligible-now' | 'upcoming';
}

export interface MessageCandidate {
  ownerTz: string;
  ownerName: string;
  ownerPhone: string;
  vaccines: EligibleVaccine[];
}

function parseDateDDMMYYYY(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
}

export function filterEligibleVaccines(
  pets: PetEligibility[],
  config: MarpetConfig
): EligibleVaccine[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eligible: EligibleVaccine[] = [];

  for (const pet of pets) {
    for (const vac of pet.vaccines) {
      // Mode 1: Only eligible now
      if (config.triggerMode === 1 && vac.eligible) {
        eligible.push({
          petName: pet.petName,
          gender: pet.gender,
          breed: pet.breed,
          vaccineName: vac.name,
          eligible: true,
          nextDate: null,
          reason: 'eligible-now',
        });
        continue;
      }

      // Mode 2: X days before next eligible date
      if (config.triggerMode === 2 && !vac.eligible && vac.nextDate) {
        const nextDate = parseDateDDMMYYYY(vac.nextDate);
        if (nextDate) {
          const daysUntil = Math.floor((nextDate.getTime() - today.getTime()) / 86400000);
          if (daysUntil >= 0 && daysUntil <= config.daysBeforeEligible) {
            eligible.push({
              petName: pet.petName,
              gender: pet.gender,
              breed: pet.breed,
              vaccineName: vac.name,
              eligible: false,
              nextDate: vac.nextDate,
              reason: 'upcoming',
            });
          }
        }
        continue;
      }

      // Mode 3: Both
      if (config.triggerMode === 3) {
        if (vac.eligible) {
          eligible.push({ petName: pet.petName, gender: pet.gender, breed: pet.breed, vaccineName: vac.name, eligible: true, nextDate: null, reason: 'eligible-now' });
        } else if (vac.nextDate) {
          const nextDate = parseDateDDMMYYYY(vac.nextDate);
          if (nextDate) {
            const daysUntil = Math.floor((nextDate.getTime() - today.getTime()) / 86400000);
            if (daysUntil >= 0 && daysUntil <= config.daysBeforeEligible) {
              eligible.push({ petName: pet.petName, gender: pet.gender, breed: pet.breed, vaccineName: vac.name, eligible: false, nextDate: vac.nextDate, reason: 'upcoming' });
            }
          }
        }
        continue;
      }

      // Mode 4: Staggered (14 days before, also eligible now)
      if (config.triggerMode === 4) {
        if (vac.eligible) {
          eligible.push({ petName: pet.petName, gender: pet.gender, breed: pet.breed, vaccineName: vac.name, eligible: true, nextDate: null, reason: 'eligible-now' });
        } else if (vac.nextDate) {
          const nextDate = parseDateDDMMYYYY(vac.nextDate);
          if (nextDate) {
            const daysUntil = Math.floor((nextDate.getTime() - today.getTime()) / 86400000);
            if (daysUntil === config.daysBeforeEligible || daysUntil === 7) {
              eligible.push({ petName: pet.petName, gender: pet.gender, breed: pet.breed, vaccineName: vac.name, eligible: false, nextDate: vac.nextDate, reason: 'upcoming' });
            }
          }
        }
      }
    }
  }

  return eligible;
}

export async function checkCooldown(
  ownerTz: string,
  petName: string,
  vaccineName: string,
  cooldownDays: number
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cooldownDays);

  const { data } = await supabase
    .from('marpet_send_log')
    .select('sent_at')
    .eq('owner_tz', ownerTz)
    .eq('pet_name', petName)
    .eq('vaccine_name', vaccineName)
    .gte('sent_at', cutoff.toISOString())
    .limit(1);

  return (data?.length || 0) > 0; // true = in cooldown (skip)
}

export async function checkMonthlyCap(ownerTz: string, maxPerMonth: number): Promise<boolean> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('marpet_send_log')
    .select('id')
    .eq('owner_tz', ownerTz)
    .gte('sent_at', startOfMonth.toISOString());

  return (data?.length || 0) >= maxPerMonth; // true = capped (skip)
}

export async function logSent(
  ownerTz: string,
  petName: string,
  vaccineName: string,
  petId?: string
): Promise<void> {
  await supabase.from('marpet_send_log').insert({
    owner_tz: ownerTz,
    pet_name: petName,
    vaccine_name: vaccineName,
    pet_id: petId || null,
    sent_at: new Date().toISOString(),
  });
}
