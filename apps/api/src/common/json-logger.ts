import type { LoggerService } from '@nestjs/common';

/**
 * Structured (one JSON object per line) logger for production log pipelines.
 * Enabled with LOG_FORMAT=json; the default Nest console logger is used otherwise.
 */
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const line = {
      time: new Date().toISOString(),
      level,
      context,
      message: typeof message === 'string' ? message : message instanceof Error ? message.message : JSON.stringify(message),
      ...extra,
    };
    (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  }

  private split(params: unknown[]): { context?: string; stack?: string } {
    const context = typeof params[params.length - 1] === 'string' ? (params[params.length - 1] as string) : undefined;
    const stack = params.length > 1 && typeof params[0] === 'string' ? (params[0] as string) : undefined;
    return { context, stack };
  }

  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, this.split(params).context);
  }
  error(message: unknown, ...params: unknown[]) {
    const { context, stack } = this.split(params);
    this.write('error', message, context, stack ? { stack } : undefined);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, this.split(params).context);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, this.split(params).context);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('verbose', message, this.split(params).context);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.write('fatal', message, this.split(params).context);
  }
}
