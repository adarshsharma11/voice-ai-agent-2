import { nikaScenario } from './nika';
import { effiScenario } from './effi';

import type { RealtimeAgent } from '@openai/agents/realtime';

// Map of scenario key -> array of RealtimeAgent objects
export const allAgentSets: Record<string, RealtimeAgent[]> = {
  nika: nikaScenario,
  effi: effiScenario,
};

export const defaultAgentSetKey = 'nika';
