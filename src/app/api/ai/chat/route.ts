/**
 * Question au copilote, réponse en SSE (Server-Sent Events).
 * Événements : `meta` (conversation), `text` (delta), `tool_start`, `tool_end`, `notice`, `done` (usage), `error`.
 * Toute la logique IA reste côté serveur ; la clé ne transite jamais ici.
 */
import Anthropic from "@anthropic-ai/sdk";
import { askCopilot, CopilotError } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(req: Request) {
  let body: { question?: string; conversationId?: string | null; contextPath?: string | null };
  try { body = await req.json(); } catch { return Response.json({ error: "Corps invalide." }, { status: 400 }); }
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "Question vide." }, { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => { try { controller.enqueue(sse(event, data)); } catch { /* client parti */ } };
      try {
        let metaSent = false;
        const out = await askCopilot({
          question, conversationId: body.conversationId ?? null, contextPath: body.contextPath ?? null, tier: "advanced", surface: "chat",
          onEvent: (e) => {
            if (!metaSent) { metaSent = true; send("meta", { started: true }); }
            send(e.type, e);
          },
        });
        send("done", { conversationId: out.conversationId, messageId: out.messageId, model: out.model, usage: out.usage, latencyMs: out.latencyMs, costUsd: out.costUsd, toolCalls: out.toolCalls, text: out.text });
      } catch (e) {
        send("error", { message: errorMessage(e), status: e instanceof CopilotError ? e.status : 500 });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

function errorMessage(e: unknown): string {
  if (e instanceof CopilotError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Clé ANTHROPIC_API_KEY refusée par l'API.";
  if (e instanceof Anthropic.RateLimitError) return "L'API Anthropic limite le débit : réessayer dans une minute.";
  if (e instanceof Anthropic.APIError) return `Erreur de l'API Anthropic (${e.status ?? "?"}).`;
  if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) return "Session expirée : se reconnecter.";
  return "Erreur inattendue du copilote.";
}
