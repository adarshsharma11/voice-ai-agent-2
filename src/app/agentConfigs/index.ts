import { nikaScenario } from './nika';

import type { RealtimeAgent } from '@openai/agents/realtime';

// Map of scenario key -> array of RealtimeAgent objects
export const allAgentSets: Record<string, RealtimeAgent[]> = {
  nika: nikaScenario,
};

export const defaultAgentSetKey = 'nika';
