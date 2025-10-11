import { EventEmitter2 } from "@nestjs/event-emitter";

export async function emitTyped<Payload, Result>(
  eventEmitter: EventEmitter2,
  event: string,
  payload: Payload
): Promise<Result> {
  const results = await eventEmitter.emitAsync(event, payload);

  // Log an toàn (không stringify circular)
  console.log(`[emitTyped] Event: ${event}, Raw results count: ${results?.length}`);

  if (Array.isArray(results)) {
    console.log(`[emitTyped] First result type: ${typeof results[0]}`);
    return results[0] as Result;
  }

  return results as Result;
}
