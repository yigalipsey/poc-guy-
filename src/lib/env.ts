// Required-env helper shared by the Next server code and the worker process.
export class MissingEnvError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}

// Read at call time, never at import time, so builds don't need secrets and one
// image works in any environment.
export function requireEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  // A blank value (e.g. a bare `FOO=` line copied from .env.example) counts as missing.
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new MissingEnvError(name);
  }
  return value;
}
