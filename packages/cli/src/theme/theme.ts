import Table from 'cli-table3';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { palette, type Tone } from './palette.js';

const toneFn = (tone: Tone): ((s: string) => string) => {
  const [r, g, b] = palette[tone];
  return (s: string): string => {
    if (chalk.level === 0) return s;
    return chalk.rgb(r, g, b)(s);
  };
};

export const glyph = {
  check: '\u2713',
  cross: '\u2717',
  arrow: '\u2192',
  warn: '\u26A0',
  dot: '\u25CF',
} as const;

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  align?: 'left' | 'right' | 'center';
}

function renderTable<T>(headers: string[], rows: T[], columns: Column<T>[]): string {
  const useAscii = chalk.level === 0;
  const chars = useAscii ? {
    top: '-', 'top-mid': '+', 'top-left': '+', 'top-right': '+',
    bottom: '-', 'bottom-mid': '+', 'bottom-left': '+', 'bottom-right': '+',
    left: '|', 'left-mid': '+', mid: '-', 'mid-mid': '+',
    right: '|', 'right-mid': '+', middle: '|',
  } : undefined;

  const table = new Table({
    head: headers,
    chars,
    style: { head: useAscii ? [] : ['bold'], border: useAscii ? [] : [] },
  });

  for (const row of rows) {
    table.push(columns.map((c) => c.get(row)));
  }

  return table.toString();
}

function headingFn(text: string): string {
  const colored = toneFn('accent')(text);
  const underline = '-'.repeat(text.length);
  return `${colored}\n${underline}`;
}

function kvFn(key: string, value: string, keyWidth = 9): string {
  const padded = key.padEnd(keyWidth, ' ');
  return `  ${toneFn('muted')(padded)}  ${value}`;
}

function lineFn(g: string, tone: Tone, text: string, meta?: string): string {
  const head = `${toneFn(tone)(g)} ${text}`;
  if (meta === undefined) return head;
  return `${head}  ${toneFn('dim')(`(${meta})`)}`;
}

function spinnerFn(text: string): Ora {
  return ora({ text, color: 'green', spinner: 'dots', stream: process.stderr });
}

export const theme = {
  accent: toneFn('accent'),
  muted: toneFn('muted'),
  dim: toneFn('dim'),
  warn: toneFn('warn'),
  err: toneFn('err'),
  glyph,
  heading: headingFn,
  kv: kvFn,
  line: lineFn,
  spinner: spinnerFn,
  table: renderTable,
};

export type Theme = typeof theme;
