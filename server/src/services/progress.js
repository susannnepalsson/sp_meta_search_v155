import { EventEmitter } from 'events';

class ProgressBus extends EventEmitter {}
export const progressBus = new ProgressBus();

export function emitProgress(evt) {
  try {
    progressBus.emit('message', { ts: new Date().toISOString(), ...evt });
  } catch {}
}
