import { createClient } from '@supabase/supabase-js';
import type { PendingMessage, AgentConfig } from './types';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === Agents ===

export async function getAgent(name: string): Promise<AgentConfig | null> {
  const { data } = await supabase
    .from('agents')
    .select('*')
    .eq('name', name)
    .single();
  return data;
}

export async function getAgentTemplates(agentId: string): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('agent_templates')
    .select('category, template_text')
    .eq('agent_id', agentId)
    .eq('is_active', true);

  const templates: Record<string, string> = {};
  for (const row of data || []) {
    templates[row.category] = row.template_text;
  }
  return templates;
}

// === Pending Messages ===

export async function insertPendingMessage(msg: Omit<PendingMessage, 'id' | 'created_at'>): Promise<string | null> {
  const { data, error } = await supabase
    .from('pending_messages')
    .insert(msg)
    .select('id')
    .single();

  if (error) { console.error('[supabase] insert error:', error.message); return null; }
  return data?.id || null;
}

export async function getPendingMessages(agentId: string, status = 'pending'): Promise<PendingMessage[]> {
  const { data } = await supabase
    .from('pending_messages')
    .select('*')
    .eq('agent_id', agentId)
    .eq('status', status)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function updateMessageStatus(id: string, status: string, approvedBy?: string): Promise<void> {
  const update: Record<string, any> = { status };
  if (approvedBy) update.approved_by = approvedBy;
  if (status === 'sent') update.sent_at = new Date().toISOString();

  await supabase.from('pending_messages').update(update).eq('id', id);
}

// === Check duplicates (same client+date) ===

export async function wasMessageSentToday(agentId: string, clientPhone: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('pending_messages')
    .select('id')
    .eq('agent_id', agentId)
    .eq('client_phone', clientPhone)
    .gte('created_at', today)
    .limit(1);
  return (data?.length || 0) > 0;
}
