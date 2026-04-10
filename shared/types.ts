// === Agent System Types ===

export type VisitCategory = 'medical' | 'new-client' | 'surgery';

export interface ClinicaSession {
  SessionID: number;
  Date: string;
  Finds: string;
  Notes: string;
  Reason: string;
  Anamneza: string;
}

export interface ClinicaVisit {
  Session: ClinicaSession;
  Date: string;
  PetID?: number;
  PetName?: string;
  PetType?: string;
  OwnerName?: string;
  OwnerPhone?: string;
  UserID?: string;
}

export interface ClassifiedVisit {
  visit: ClinicaVisit;
  category: VisitCategory;
  petName: string;
  ownerName: string;
  ownerPhone: string;
  details: string; // extracted treatment details for AI
}

export interface PendingMessage {
  id?: string;
  agent_id: string;
  client_name: string;
  client_phone: string;
  pet_name: string;
  category: VisitCategory;
  message_text: string;
  status: 'pending' | 'approved' | 'sent' | 'rejected';
  approved_by: string | null;
  sent_at: string | null;
  created_at?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  cron_schedule: string;
  config: Record<string, any>;
}
