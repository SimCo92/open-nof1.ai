import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const deepseekModel = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openrouter = openrouterApiKey
  ? createOpenRouter({
      apiKey: openrouterApiKey,
    })
  : null;

export const deepseek = deepseekModel("deepseek-chat");
export const deepseekThinking = deepseekModel("deepseek-reasoner");

export const deepseekR1 = openrouter
  ? openrouter("deepseek/deepseek-r1-0528")
  : deepseekThinking;

export const deepseekv31 = openrouter
  ? openrouter("deepseek/deepseek-v3.2-exp")
  : deepseek;
