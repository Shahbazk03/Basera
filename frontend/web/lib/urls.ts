/** URL helpers usable from both server and client components. */
export function consoleUrl(path = '/'): string {
  return `${process.env.NEXT_PUBLIC_CONSOLE_URL ?? ''}${path}`;
}
