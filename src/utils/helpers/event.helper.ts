// file: utils/event-helper.ts
import { EventEmitter2 } from '@nestjs/event-emitter';

export async function emitTyped<TPayload, TResult>(
  emitter: EventEmitter2,
  event: string,
  payload: TPayload,
): Promise<TResult> {
  const [result] = await emitter.emitAsync(event, payload);
  return result as TResult;
}
