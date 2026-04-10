import { getIsraelDate } from '../../shared/clinica';
import { fetchVaccineLaters, filterLaters, groupByOwner, type GroupedReminder } from './vaccine-scanner';

export interface DeepScanOptions {
  years?: number;
  minMonthsExpired?: number;
  onlyMandatory?: boolean;
  excludeWithAppointment?: boolean;
  dryRun?: boolean;
}

export async function runDeepScan(options: DeepScanOptions = {}): Promise<GroupedReminder[]> {
  const {
    years = 3,
    minMonthsExpired = 3,
    onlyMandatory = false,
    excludeWithAppointment = true,
  } = options;

  console.log(`[deep-scan] Starting deep scan: ${years} years back, min ${minMonthsExpired} months expired`);
  if (onlyMandatory) console.log('[deep-scan] Only mandatory vaccines (כלבת, משושה, מרובע, מתומן)');

  const today = getIsraelDate();
  const fromDate = getIsraelDate(-years * 365);

  const raw = await fetchVaccineLaters(fromDate, today);
  const filtered = filterLaters(raw, {
    excludeWithAppointment,
    excludeConfirmed: true,
    minMonthsExpired,
    onlyMandatory,
  });

  const grouped = groupByOwner(filtered);

  console.log(`[deep-scan] Found ${grouped.length} owners with expired vaccines (${filtered.length} total records)`);
  return grouped;
}
