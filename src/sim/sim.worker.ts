// The simulation, off the main thread.
import { Runner, ToSim, FromSim } from './runner';

const runner = new Runner(
  (m: FromSim, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []),
  () => performance.now(),
);
self.onmessage = (e: MessageEvent<ToSim>) => runner.handle(e.data);
// tell the page we're alive, so it doesn't fall back to the main thread
(self as unknown as Worker).postMessage({ type: 'ready' });
const loop = () => {
  runner.pump(10);
  setTimeout(loop, 4);
};
loop();
