export interface PromptBackend {
  input(opts: { message: string; default?: string }): Promise<string>;
  password(opts: { message: string }): Promise<string>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  select<T extends string>(opts: {
    message: string;
    choices: Array<{ name: string; value: T; description?: string }>;
    default?: T;
  }): Promise<T>;
  number(opts: { message: string; default?: number; min?: number }): Promise<number>;
}

export interface FakeAnswer {
  kind: "input" | "password" | "confirm" | "select" | "number";
  value: unknown;
}

export function createFakePromptBackend(queue: FakeAnswer[]): PromptBackend {
  const pull = (kind: FakeAnswer["kind"]): unknown => {
    const next = queue.shift();
    if (!next) throw new Error("fake backend ran out of answers");
    if (next.kind !== kind) {
      throw new Error(
        `fake backend kind mismatch — expected ${kind}, got ${next.kind}`,
      );
    }
    return next.value;
  };

  const wrap = <R>(kind: FakeAnswer["kind"]): Promise<R> => {
    try {
      return Promise.resolve(pull(kind) as R);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };

  return {
    input: () => wrap<string>("input"),
    password: () => wrap<string>("password"),
    confirm: () => wrap<boolean>("confirm"),
    select: () => wrap<string>("select"),
    number: () => wrap<number>("number"),
  } as PromptBackend;
}
