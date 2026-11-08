// Let the worker's event loop turn after every test.
// Most tests run a whole simulation synchronously, and the awaits between tests are only microtasks,
// so a file of them can hold the worker for most of a minute. Vitest's worker talks to the main
// process over an RPC with a 60 s timeout, and when the reply can't be read until the file ends
// the run fails with "Timeout calling onTaskUpdate" even though every test passed.
// One turn (setImmediate) isn't always enough on a loaded CI runner: the main process's reply may
// not have arrived yet, and is then left unread through the next test (two long tests back to back,
// 23 s and 40 s in the long-run file, went over the minute). A short real wait lets it land.
import { afterEach } from 'vitest';

afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
