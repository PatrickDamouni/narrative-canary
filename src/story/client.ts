import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { MODEL, type Ask, type IterationUsage } from "./generate.ts";

/**
 * The real Claude call. It never throws on a bad turn: API errors, declines, cut-off output, and
 * unparseable output all come back as a recorded result, so one failure cannot silently end a run.
 * Server-side fallbacks are on; a fallback-served turn is recorded with the model that served it.
 */
export function claudeAsk(client = new Anthropic()): Ask {
  return async ({ system, prompt, schema }) => {
    const format = betaZodOutputFormat(schema);
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
        output_config: { format }
      });
      const iterations: IterationUsage[] = (response.usage.iterations ?? []).flatMap(item =>
        "model" in item && "input_tokens" in item
          ? [{ type: item.type, model: String(item.model), input_tokens: item.input_tokens, output_tokens: item.output_tokens,
              cache_read_input_tokens: item.cache_read_input_tokens ?? 0, cache_creation_input_tokens: item.cache_creation_input_tokens ?? 0 }]
          : []);
      const fallbackModel = iterations.find(item => item.type === "fallback_message")?.model ?? null;
      // After a fallback, the last text block is the serving model's answer.
      const text = response.content.filter(block => block.type === "text").at(-1)?.text ?? null;
      let output = null;
      let error = null;
      if (response.stop_reason === "end_turn" && text !== null) {
        try { output = format.parse(text); } catch { error = "parse_error"; }
      }
      return { output, stopReason: response.stop_reason ?? null, error, usage: response.usage, iterations,
        fallbackModel, requestId: response._request_id ?? null, model: response.model };
    } catch (caught) {
      if (!(caught instanceof Anthropic.APIError)) throw caught;
      return { output: null, stopReason: null, error: `api_error:${caught.status ?? "network"}`,
        usage: { input_tokens: 0, output_tokens: 0 }, iterations: [], fallbackModel: null,
        requestId: caught.requestID ?? null, model: MODEL };
    }
  };
}
