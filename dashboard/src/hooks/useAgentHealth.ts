import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api';

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface AgentHealth {
  agent: string;
  status: HealthStatus;
  reasons: string[];
  last_run_at: string | null;
  last_checked: string;
  ack_until: string | null;
  acked: boolean;
  reason_hash: string;
}

interface HealthResponse {
  agents: AgentHealth[];
  checked_at: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function apiBase(): string {
  return "";
}

export function useAgentHealth() {
  const [data, setData] = useState<Record<string, AgentHealth>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase()}/api/agents/health`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body: HealthResponse = await res.json();
      const map: Record<string, AgentHealth> = {};
      for (const h of body.agents || []) map[h.agent] = h;
      setData(map);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const ack = useCallback(async (agent: string, durationHours = 24) => {
    try {
      const res = await apiFetch(`${apiBase()}/api/agents/health/${agent}/ack`, {
        method: 'POST',
        body: JSON.stringify({ duration_hours: durationHours }),
      });
      if (res.ok) await load();
      return res.ok;
    } catch {
      return false;
    }
  }, [load]);

  return { data, loading, error, reload: load, ack };
}

/** Map dashboard agent-card name → backend health key. */
export function healthKeyFor(agentName: string): string {
  // backend uses underscore form for these two
  if (agentName === 'appointment-reminder') return 'appointment_reminder';
  if (agentName === 'appointment-booker') return 'appointment_booker';
  return agentName;
}

/** Tailwind classes for the primary button, based on status. */
export function statusButtonClass(status: HealthStatus | undefined): string {
  switch (status) {
    case 'red':
      return 'bg-red-600 hover:bg-red-700';
    case 'yellow':
      return 'bg-amber-500 hover:bg-amber-600';
    case 'unknown':
      return 'bg-gray-400 hover:bg-gray-500';
    case 'green':
      return 'bg-emerald-600 hover:bg-emerald-700';
    default:
      return 'bg-emerald-600 hover:bg-emerald-700';
  }
}

/** Short Hebrew tooltip summarizing an agent health card. */
export function statusTooltipText(h: AgentHealth | undefined): string {
  if (!h) return 'אין נתונים';
  if (h.status === 'green') return 'תקין';
  if (h.status === 'unknown') return 'אין נתונים';
  const reasons = (h.reasons || []).filter(Boolean);
  if (!reasons.length) {
    return h.status === 'red' ? 'תקלה חמורה' : 'אזהרה';
  }
  return reasons.join(' • ');
}
