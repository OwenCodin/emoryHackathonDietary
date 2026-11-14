import { llm } from '@livekit/agents';
import { z } from 'zod';
// This is the only file that imports renal/ and actions/. The remaining tools (look_at_camera,
// suggest_meal, log_meal, todays_totals, start_cart, cart_status, text_cart_link) arrive in Phase 3.
import { checkFood, getProfile } from '../renal/index.mjs';

export function buildTools({ patientId }) {
  return {
    // Anonymous tool: the object key is the tool name.
    check_food: llm.tool({
      description: 'Judge a food the caller names without showing it.',
      parameters: z.object({ name: z.string(), grams: z.number().nullable() }),
      execute: async ({ name, grams }) => {
        const got = await getProfile({ patientId });
        if (!got.ok) return got;
        return checkFood({ food: { name, grams }, profile: got.profile });
      },
    }),
  };
}
