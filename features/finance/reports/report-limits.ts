import type { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";

export const reportFormats = {
  pdf: { rows: 1000, bytes: 8 * 1024 * 1024, mime: "application/pdf" },
  xlsx: {
    rows: 10000,
    bytes: 16 * 1024 * 1024,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
} as const;

export class ReportLimitError extends Error {}
export class ReportTimeoutError extends Error {}

export function createReportWork(signal?: AbortSignal, milliseconds = 15000) {
  const deadline = performance.now() + milliseconds;
  function check() {
    if (signal?.aborted || performance.now() >= deadline) throw new ReportTimeoutError();
  }
  return {
    check,
    async pause() {
      await setImmediate();
      check();
    },
  };
}

export type ReportWork = ReturnType<typeof createReportWork>;

export async function collectReportBytes(readable: Readable, maxBytes: number, drainOnLimit = false) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of readable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      if (!drainOnLimit) throw new ReportLimitError();
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (bytes > maxBytes) throw new ReportLimitError();
  return Buffer.concat(chunks, bytes);
}

type AdmissionResult = { status: 429 | 503 } | { release: () => void };

export function createReportAdmission() {
  const active = new Set<number>();
  return {
    admit(userId: number): AdmissionResult {
      if (active.has(userId)) return { status: 429 };
      if (active.size >= 2) return { status: 503 };

      active.add(userId);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          active.delete(userId);
        },
      };
    },
  };
}
