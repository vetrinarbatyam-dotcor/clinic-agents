/**
 * marpet-reminder/src/index.ts
 * NEW FLOW v2: Start from GetInsuredReportForExcel (InsuredVisit records) as source of truth.
 * Dedupe by IdNumber. Phone/Name from InsuredVisit. Pet name from Marpet response.
 * Usage: bun run marpet-reminder/src/index.ts --dry-run [--limit N]
 */

import 'dotenv/config';
import { getAgent, insertPendingMessage } from '../../shared/supabase';
import { sendWhatsApp } from '../../shared/whatsapp';
import { callAsmx } from '../../shared/clinica';
import { loginMarpet, fetchEligibilityForOwner } from './marpet-scraper';

import {
  filterEligibleVaccines,
  checkCooldown,
  checkMonthlyCap,
  logSent,
  DEFAULT_CONFIG,
} from './eligibility-logic';
import { buildMessage, buildMultiPetMessage } from './message-builder';
import { supabase } from '../../shared/supabase';

const DRY_RUN = process.argv.includes('--dry-run');
const GIL_PHONE = '0543123419';
const AGENT_NAME = 'marpet-reminder';

function getLimit(): number | null {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1]) || null;
  return null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '').replace(/^972/, '0');
}

interface InsuredVisit {
  idNumber: string;
  fullName: string;
  phone: string;
  rawDate?: string;
}

async function loadInsuredVisits(): Promise<InsuredVisit[]> {
  console.log('[marpet] Fetching GetInsuredReportForExcel from ClinicaOnline...');
  try {
    const records = await callAsmx('GetInsuredReportForExcel', {
      Branch: 0,
      insuranceName: 'מרפאט',
    }) as any[];

    if (!Array.isArray(records)) {
      console.error('[marpet] GetInsuredReportForExcel did not return an array:', typeof records);
      return [];
    }

    console.log('[marpet] Raw records from API:', records.length);

    if (records.length > 0) {
      console.log('[marpet] Field names in first record:', Object.keys(records[0]).join(', '));
      console.log('[marpet] First record sample:', JSON.stringify(records[0]).slice(0, 600));
    }

    const visits: InsuredVisit[] = [];
    const cutoff12m = new Date();
    cutoff12m.setFullYear(cutoff12m.getFullYear() - 1);

    for (const r of records) {
      const idNumber = String(r.IdNumber || r.idNumber || r.ID || '').trim();
      if (!idNumber || idNumber.length < 7) continue;

      const rawDate = r.SessionDate || r.VisitDate || r.Date || r.TreatmentDate || r.DateOfVisit || '';
      const phone = normalizePhone(String(r.Phone || r.CellPhone || r.Mobile || ''));
      const fullName = String(r.FullName || r.ClientName || r.OwnerName || '').trim();

      // 12-month filter: if parseable date exists, apply it; otherwise include all
      if (rawDate) {
        const visitDate = new Date(rawDate);
        if (!isNaN(visitDate.getTime()) && visitDate < cutoff12m) continue;
      }

      visits.push({ idNumber, fullName, phone, rawDate });
    }

    console.log('[marpet] After 12m filtering:', visits.length, 'visits with valid IdNumber');
    return visits;
  } catch (e: any) {
    console.error('[marpet] Failed to fetch InsuredVisit records:', e.message);
    return [];
  }
}

interface OwnerRecord {
  idNumber: string;
  fullName: string;
  phone: string;
  visitCount: number;
}

function dedupeByIdNumber(visits: InsuredVisit[]): OwnerRecord[] {
  const map = new Map<string, OwnerRecord>();
  for (const v of visits) {
    const existing = map.get(v.idNumber);
    if (!existing) {
      map.set(v.idNumber, { idNumber: v.idNumber, fullName: v.fullName, phone: v.phone, visitCount: 1 });
    } else {
      existing.visitCount++;
      if (!existing.phone && v.phone) existing.phone = v.phone;
      if (!existing.fullName && v.fullName) existing.fullName = v.fullName;
    }
  }
  return [...map.values()];
}

async function run() {
  console.log('[marpet] === Marpet Reminder v2 (InsuredVisit flow)', DRY_RUN ? '(DRY RUN)' : '', '===');
  console.log('[marpet]', new Date().toLocaleString('he-IL'));

  const agent = await getAgent(AGENT_NAME);
  if (!agent) {
    console.error('[marpet] Agent not found in DB. Run migration SQL first.');
    process.exit(1);
  }
  if (!agent.is_active) {
    console.log('[marpet] Agent is disabled. Exiting.');
    return;
  }

  const rawConfig = agent.config || {};
  const config = {
    ...DEFAULT_CONFIG,
    triggerMode: rawConfig.triggerMode ?? DEFAULT_CONFIG.triggerMode,
    daysBeforeEligible: rawConfig.daysBeforeEligible ?? DEFAULT_CONFIG.daysBeforeEligible,
    cooldownDays: rawConfig.cooldownDays ?? DEFAULT_CONFIG.cooldownDays,
    maxPerOwnerPerMonth: rawConfig.maxPerOwnerPerMonth ?? DEFAULT_CONFIG.maxPerOwnerPerMonth,
    approvalMode: rawConfig.approvalMode ?? DEFAULT_CONFIG.approvalMode,
    messageTemplate: rawConfig.messageTemplate ?? null,
  };
  console.log('[marpet] Config: mode=' + config.triggerMode + ', cooldown=' + config.cooldownDays + 'd, cap=' + config.maxPerOwnerPerMonth + '/month');

  console.log('[marpet] Step 1: Loading Marpet insured visits from ClinicaOnline...');
  const visits = await loadInsuredVisits();

  if (visits.length === 0) {
    console.log('[marpet] No InsuredVisit records found. Check ClinicaOnline connection.');
    return;
  }

  console.log('[marpet] Step 2: Deduplicating by IdNumber...');
  const allOwners = dedupeByIdNumber(visits);
  console.log('[marpet] Unique owners after dedupe:', allOwners.length, '(from', visits.length, 'visit records)');

  const limit = getLimit();
  const owners = limit ? allOwners.slice(0, limit) : allOwners;
  console.log('[marpet] Processing:', owners.length, 'owners' + (limit ? ' (limited to ' + limit + ')' : ''));

  const ownersWithPhone = owners.filter(o => o.phone).length;
  console.log('[marpet] With phone:', ownersWithPhone, ', Without phone:', owners.length - ownersWithPhone);

  console.log('[marpet] Step 3: Logging in to Marpet portal...');
  await loginMarpet();

  console.log('[marpet] Step 4: Fetching eligibility per owner...');
  const pendingMessages: Array<{ ownerName: string; ownerPhone: string; petName: string; vaccines: string; message: string }> = [];
  const skipped: string[] = [];
  let marpetNotFound = 0;
  let eligibilitySuccess = 0;
  const parseIssues: string[] = [];
  let processed = 0;
  const total = owners.length;

  for (const owner of owners) {
    processed++;
    const displayName = owner.fullName || owner.idNumber;
    process.stdout.write('[marpet] Processing ' + processed + '/' + total + ' (' + displayName + ')...\r');

    if (!owner.phone) {
      skipped.push(displayName + ' -- no phone');
      continue;
    }

    const capped = await checkMonthlyCap(owner.idNumber, config.maxPerOwnerPerMonth);
    if (capped) { skipped.push(displayName + ' -- monthly cap'); continue; }

    let marpetResult;
    try {
      marpetResult = await fetchEligibilityForOwner(owner.idNumber);
    } catch (e: any) {
      skipped.push(displayName + ' -- Marpet error: ' + e.message);
      continue;
    }

    if (!marpetResult || marpetResult.pets.length === 0) {
      marpetNotFound++;
      if (marpetResult?.error) parseIssues.push(displayName + ': ' + marpetResult.error);
      continue;
    }

    eligibilitySuccess++;

    if (!DRY_RUN) {
      await supabase.from('marpet_owner_map').upsert({
        client_id: 'insured_' + owner.idNumber,
        owner_tz: owner.idNumber,
        found_via: 'clinica_claims',
        last_verified: new Date().toISOString(),
      }, { onConflict: 'client_id' });

      for (const pet of marpetResult.pets) {
        for (const vac of pet.vaccines) {
          await supabase.from('marpet_eligibility').upsert({
            pet_name: pet.petName,
            owner_tz: owner.idNumber,
            vaccine_name: vac.name,
            status: vac.eligible ? 'eligible' : 'not-eligible',
            next_date: vac.nextDate || null,
            fetched_at: marpetResult.fetchedAt,
          }, { onConflict: 'owner_tz,pet_name,vaccine_name' });
        }
      }
    }

    const eligibleVaccines = filterEligibleVaccines(marpetResult.pets, config);
    if (eligibleVaccines.length === 0) continue;

    const filteredVaccines = [];
    for (const ev of eligibleVaccines) {
      const inCooldown = await checkCooldown(owner.idNumber, ev.petName, ev.vaccineName, config.cooldownDays);
      if (!inCooldown) filteredVaccines.push(ev);
    }
    if (filteredVaccines.length === 0) { skipped.push(displayName + ' -- all in cooldown'); continue; }

    const eligiblePetNames = [...new Set(filteredVaccines.map(v => v.petName))];
    const isMultiPet = eligiblePetNames.length > 1;
    const ownerDisplayName = owner.fullName || displayName;

    const message = isMultiPet
      ? buildMultiPetMessage({ ownerName: ownerDisplayName, eligibleVaccines: filteredVaccines, templateOverride: config.messageTemplate })
      : buildMessage({ ownerName: ownerDisplayName, petName: eligiblePetNames[0], eligibleVaccines: filteredVaccines, templateOverride: config.messageTemplate });

    const vaccinesSummary = filteredVaccines.map(v => v.petName + ':' + v.vaccineName).join(', ');
    const petLabel = eligiblePetNames.join(', ');

    if (DRY_RUN) {
      console.log('\n--- DRY RUN ---');
      console.log('To:', ownerDisplayName, '(' + owner.phone + ') | TZ:', owner.idNumber);
      console.log('Marpet pets:', marpetResult.pets.map(p => p.petName).join(', '));
      console.log('Eligible pets:', petLabel, '| Vaccines:', vaccinesSummary);
      console.log('Message:\n' + message);
      console.log('---------------');
      pendingMessages.push({ ownerName: ownerDisplayName, ownerPhone: owner.phone, petName: petLabel, vaccines: vaccinesSummary, message });
      continue;
    }

    await insertPendingMessage({
      agent_id: agent.id,
      client_name: ownerDisplayName,
      client_phone: owner.phone,
      pet_name: petLabel,
      category: 'marpet-vaccine' as any,
      message_text: message,
      status: 'pending',
      approved_by: null,
      sent_at: null,
    });

    for (const v of filteredVaccines) {
      await logSent(owner.idNumber, v.petName, v.vaccineName);
    }

    pendingMessages.push({ ownerName: ownerDisplayName, ownerPhone: owner.phone, petName: petLabel, vaccines: vaccinesSummary, message });
  }

  process.stdout.write('\n');

  console.log('[marpet] === Summary ===');
  console.log('[marpet] InsuredVisit records from ClinicaOnline:', visits.length);
  console.log('[marpet] Unique owners (dedupe by IdNumber):', allOwners.length);
  console.log('[marpet] Processed:', processed);
  console.log('[marpet] Got eligibility from Marpet:', eligibilitySuccess);
  console.log('[marpet] Not found in Marpet:', marpetNotFound);
  console.log('[marpet] Would send messages:', pendingMessages.length);
  console.log('[marpet] Skipped:', skipped.length);
  if (skipped.length > 0) skipped.slice(0, 10).forEach(s => console.log('  -', s));

  if (parseIssues.length > 0) {
    console.log('[marpet] Marpet HTML parse issues (' + parseIssues.length + '):');
    parseIssues.slice(0, 5).forEach(p => console.log('  *', p));
  }

  if (DRY_RUN) {
    console.log('[marpet] Dry run complete.');
    return;
  }

  if (pendingMessages.length > 0) {
    const lines = pendingMessages.slice(0, 15).map((m, i) => (i + 1) + '. ' + m.ownerName + ' (' + m.ownerPhone + ') -- ' + m.petName + ': ' + m.vaccines);
    const summary = ['Marpet Reminder -- ' + new Date().toLocaleDateString('he-IL'), '', 'Pending approval: ' + pendingMessages.length, '', ...lines, '', 'Approve: http://167.86.69.208:3000'].join('\n');
    const result = await sendWhatsApp(GIL_PHONE, summary);
    console.log('[marpet] Summary sent to Gil:', result.sent ? 'OK' : result.error);
  }

  console.log('[marpet] Done!');
}

run().catch(e => {
  console.error('[marpet] Fatal error:', e);
  process.exit(1);
});
