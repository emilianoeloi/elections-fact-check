/** Fila com limite de concorrência, timeout por tarefa e cancelamento em massa. */
export class TaskQueue {
  private running = 0;
  private waiting: (() => void)[] = [];
  private ac = new AbortController();

  constructor(private concurrency: number, private timeoutMs: number) {}

  get pending(): number {
    return this.waiting.length + this.running;
  }

  /** Cancela tudo: tarefas em execução recebem abort; as que esperam são rejeitadas. */
  cancelAll(): void {
    this.ac.abort();
    this.waiting.splice(0).forEach((w) => w());
  }

  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signalAll = this.ac.signal;
    if (this.running >= this.concurrency) await new Promise<void>((res) => this.waiting.push(res));
    if (signalAll.aborted) throw new DOMException('Cancelado', 'AbortError');
    this.running++;
    try {
      return await task(AbortSignal.any([signalAll, AbortSignal.timeout(this.timeoutMs)]));
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
