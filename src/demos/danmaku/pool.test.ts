import { describe, expect, test } from 'bun:test';
import { Pool } from './pool';

interface Box {
  hits: number;
}

const makePool = () =>
  new Pool<Box>(
    () => ({ hits: 0 }),
    (b) => {
      b.hits = 0;
    },
  );

describe('Pool', () => {
  test('acquire creates a fresh object when empty', () => {
    const pool = makePool();
    const a = pool.acquire();
    expect(a).toEqual({ hits: 0 });
    expect(pool.created).toBe(1);
  });

  test('released objects are reused instead of allocating', () => {
    const pool = makePool();
    const a = pool.acquire();
    a.hits = 5;
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a); // same instance reused
    expect(pool.created).toBe(1); // no new allocation
  });

  test('reset runs on release so reused objects come back clean', () => {
    const pool = makePool();
    const a = pool.acquire();
    a.hits = 9;
    pool.release(a);
    expect(pool.acquire().hits).toBe(0);
  });

  test('it grows under concurrent demand', () => {
    const pool = makePool();
    const a = pool.acquire();
    const b = pool.acquire();
    expect(b).not.toBe(a);
    expect(pool.created).toBe(2);
  });

  test('tracks the number of live (acquired, not released) objects', () => {
    const pool = makePool();
    const a = pool.acquire();
    pool.acquire();
    expect(pool.live).toBe(2);
    pool.release(a);
    expect(pool.live).toBe(1);
  });
});
