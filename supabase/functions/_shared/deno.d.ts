interface DenoEnvironment {
  get(name: string): string | undefined;
}

interface DenoRuntime {
  readonly env: DenoEnvironment;
  serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare const Deno: DenoRuntime;
