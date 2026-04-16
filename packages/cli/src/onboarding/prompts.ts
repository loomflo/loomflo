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
  const pull = <T>(kind: FakeAnswer["kind"]): T => {
    const next = queue.shift();
    if (!next) throw new Error("fake backend ran out of answers");
    if (next.kind !== kind) {
      throw new Error(
        `fake backend kind mismatch — expected ${kind}, got ${next.kind}`,
      );
    }
    return next.value as T;
  };

  return {
    input: async () => pull<string>("input"),
    password: async () => pull<string>("password"),
    confirm: async () => pull<boolean>("confirm"),
    select: async () => pull<string>("select"),
    number: async () => pull<number>("number"),
  } as PromptBackend;
}
