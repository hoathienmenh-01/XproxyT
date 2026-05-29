/**
 * Stream Watchdog — monitors upstream streams for stalls/dead streams.
 * If no data arrives within the idle timeout, the upstream is aborted.
 */

export interface WatchdogOptions {
  /** Milliseconds of silence before declaring stream idle (default 25000) */
  idleTimeoutMs?: number;
  /** Called when the stream is detected as idle */
  onIdle?: () => void;
  /** Label for log messages */
  label?: string;
}

export class StreamWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private onIdle?: () => void;
  private label: string;
  private active = false;
  private paused = false;

  constructor(options: WatchdogOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 25_000;
    this.onIdle = options.onIdle;
    this.label = options.label ?? 'StreamWatchdog';
  }

  /** Start monitoring. Call after attaching to a stream. */
  start(): void {
    this.active = true;
    this.paused = false;
    this.resetTimer();
  }

  /** Reset the idle timer — call this on every data chunk received. */
  heartbeat(): void {
    if (!this.active || this.paused) return;
    this.resetTimer();
  }

  /** Pause monitoring (e.g. during backpressure). */
  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  /** Resume monitoring after a pause. */
  resume(): void {
    if (!this.active) return;
    this.paused = false;
    this.resetTimer();
  }

  /** Stop monitoring entirely. */
  stop(): void {
    this.active = false;
    this.paused = false;
    this.clearTimer();
  }

  /** Returns true if the watchdog triggered an idle timeout. */
  isIdle(): boolean {
    return this.active && !this.paused && this.timer === null;
  }

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      console.warn(`[${this.label}] Stream idle for ${this.idleTimeoutMs}ms — triggering idle callback`);
      this.onIdle?.();
    }, this.idleTimeoutMs);
    // Prevent the timer from keeping the process alive
    const t = this.timer as any;
    if (t && typeof t.unref === 'function') {
      t.unref();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Attach a watchdog to a Node.js readable stream.
 * Returns the watchdog instance; call watchdog.stop() when done.
 */
export function attachWatchdog(
  stream: { on: Function; off?: Function; removeListener?: Function },
  options: WatchdogOptions = {},
): StreamWatchdog {
  const watchdog = new StreamWatchdog(options);

  const onData = () => watchdog.heartbeat();
  const onEnd = () => watchdog.stop();
  const onError = () => watchdog.stop();
  const onClose = () => watchdog.stop();

  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.on('error', onError);
  stream.on('close', onClose);

  // Wrap stop to also remove listeners
  const originalStop = watchdog.stop.bind(watchdog);
  watchdog.stop = () => {
    originalStop();
    const remove = (stream as any).off || (stream as any).removeListener;
    if (remove) {
      remove.call(stream, 'data', onData);
      remove.call(stream, 'end', onEnd);
      remove.call(stream, 'error', onError);
      remove.call(stream, 'close', onClose);
    }
  };

  return watchdog;
}