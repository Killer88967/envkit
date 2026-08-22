import pc from "picocolors";

export function printTitle(title: string): void {
  console.log(pc.bold(pc.cyan(title)));
}

export function printInfo(message: string): void {
  console.log(`${pc.cyan("●")} ${message}`);
}

export function printSuccess(message: string): void {
  console.log(`${pc.green("✓")} ${message}`);
}

export function printWarning(message: string): void {
  console.log(`${pc.yellow("⚠")} ${message}`);
}

export function printError(message: string): void {
  console.error(`${pc.red("✗")} ${message}`);
}

export function printDiffSymbol(type: string): string {
  switch (type) {
    case "added":
      return pc.green("+");
    case "removed":
      return pc.red("-");
    case "changed":
      return pc.yellow("~");
    case "unchanged":
      return pc.dim("=");
    case "unknown":
      return pc.magenta("?");
    default:
      return pc.dim("?");
  }
}

export function printKeyValue(
  key: string,
  value: string,
  secret = false,
): void {
  const displayKey = pc.bold(key);
  const displayValue = secret ? pc.dim(value) : value;

  const suffix = secret ? ` ${pc.yellow("[secret]")}` : "";

  console.log(`${displayKey}=${displayValue}${suffix}`);
}
