import { effiAssistantAgent } from './assistant';
import { effiOutboundAgent } from './outbound';
import { effiCustomerServiceAgent } from './customerService';

// Allow transfers between the Effi agents.
(effiCustomerServiceAgent.handoffs as any).push(effiAssistantAgent, effiOutboundAgent);
(effiAssistantAgent.handoffs as any).push(effiCustomerServiceAgent, effiOutboundAgent);
(effiOutboundAgent.handoffs as any).push(effiCustomerServiceAgent, effiAssistantAgent);

export const effiScenario = [effiCustomerServiceAgent, effiAssistantAgent, effiOutboundAgent];

export const effiCompanyName = 'MOMA House';

// Used by App.tsx to set audio playback speed for Effi agents (client-side).
// All agents use the same speed for consistency.
export const effiPlaybackRateByAgentName: Record<string, number> = {
  // Match Nika's speed (faster)
  [effiAssistantAgent.name]: 1.5,
  [effiOutboundAgent.name]: 1.5,
  [effiCustomerServiceAgent.name]: 1.5,
};

