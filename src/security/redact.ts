const SECRET_PATTERNS = [
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /auth[_-]?key/i,
  /credential/i,
  /credentials?/i,
];

export function looksSecret(name: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(name));
}

export function redact(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return "********";
}

export function redactEnvValue(
  name: string,
  value: string | undefined,
): string | undefined {
  if (!looksSecret(name)) {
    return value;
  }

  return redact(value);
}
