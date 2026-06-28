/**
 * A tiny object pool. Spawning thousands of danmaku per minute would thrash the
 * GC if every comment allocated a fresh entity; instead we recycle them.
 */
export class Pool<T> {
  private freeList: T[] = [];
  private _created = 0;
  private _live = 0;

  constructor(
    private factory: () => T,
    private reset: (obj: T) => void,
  ) {}

  /** Total objects ever allocated (a pool that never grows past N proves reuse). */
  get created(): number {
    return this._created;
  }

  /** Currently acquired-but-not-released objects. */
  get live(): number {
    return this._live;
  }

  acquire(): T {
    const obj = this.freeList.pop() ?? (this._created++, this.factory());
    this._live++;
    return obj;
  }

  release(obj: T): void {
    this.reset(obj);
    this.freeList.push(obj);
    this._live--;
  }
}
