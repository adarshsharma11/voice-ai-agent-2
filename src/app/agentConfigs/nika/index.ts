import { nikaAssistantAgent } from './assistant';
import { nikaOutboundAgent } from './outbound';
import { nikaCustomerServiceAgent } from './customerService';

// Allow transfers between the Nika agents.
(nikaCustomerServiceAgent.handoffs as any).push(nikaAssistantAgent, nikaOutboundAgent);
(nikaAssistantAgent.handoffs as any).push(nikaCustomerServiceAgent, nikaOutboundAgent);
(nikaOutboundAgent.handoffs as any).push(nikaCustomerServiceAgent, nikaAssistantAgent);

export const nikaScenario = [nikaCustomerServiceAgent, nikaAssistantAgent, nikaOutboundAgent];

export const nikaCompanyName = 'NikaTech Solutions';

// Used by App.tsx to set audio playback speed for Nika (client-side).
// All agents now use the same faster speed for consistency.
export const nikaPlaybackRateByAgentName: Record<string, number> = {
  [nikaAssistantAgent.name]: 1.5,
  [nikaOutboundAgent.name]: 1.5,
  [nikaCustomerServiceAgent.name]: 1.5,
};

