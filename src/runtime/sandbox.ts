import vm from 'node:vm'

export class ScriptError extends Error {
  constructor(
    message: string,
    public readonly scriptStack?: string,
    public readonly failingLine?: string,
    public readonly timedOut: boolean = false,
    /**
     * Everything the script printed before it died. A long build prints its
     * progress as it goes, and losing that on a timeout is losing the only
     * record of how far it got — measured three times in one session, each
     * costing a full re-derivation from the world state.
     */
    public readonly output?: string,
  ) {
    super(message)
    this.name = 'ScriptError'
  }
}

export const NO_PRINT_HINT =
  'HINT: script completed but printed nothing — use print(...)/printJson(...) to return data.'

const MAX_LINES = 2000
const MAX_BYTES = 262144
const HARD_LINE_CAP = 20000

function extractFailingLine(stack: string | undefined, srcLines: string[]): string | undefined {
  const m = /craft-script\.js:(\d+)/.exec(stack ?? '')
  if (!m) return undefined
  const n = Number(m[1])
  const src = srcLines[n - 1]
  return src !== undefined ? `line ${n}: ${src.trim()}` : undefined
}

function renderOutput(lines: string[], skipped: number): string {
  let all = skipped > 0 ? [...lines, `[output truncated: ${skipped} further lines dropped]`] : lines
  if (all.length > MAX_LINES) {
    const omitted = all.length - 100 - (MAX_LINES - 101)
    all = [...all.slice(0, 100), `[output truncated: ${omitted} lines omitted]`, ...all.slice(-(MAX_LINES - 101))]
  }
  let text = all.join('\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    // Keep the tail — verification output lives at the end.
    text = `[output truncated to the last ${MAX_BYTES} bytes]\n` + text.slice(-MAX_BYTES)
  }
  return text
}

export async function executeScript(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const lines: string[] = []
  let skipped = 0
  const push = (line: string) => {
    if (lines.length < HARD_LINE_CAP) lines.push(line)
    else skipped++
  }
  const srcLines = code.split('\n')
  const context = vm.createContext({
    ...scope,
    print: (...args: unknown[]) => push(args.map(String).join(' ')),
    printJson: (value: unknown) => {
      const s = JSON.stringify(value, null, 2)
      push(s === undefined ? 'undefined' : s)
    },
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  })

  let fn: () => Promise<unknown>
  try {
    fn = vm.runInContext(`(async () => {\n${code}\n})`, context, {
      filename: 'craft-script.js',
      lineOffset: -1, // reported numbers match the user's code, not the wrapper
      timeout: timeoutMs,
    }) as () => Promise<unknown>
  } catch (e) {
    const err = e as Error
    throw new ScriptError(
      `Script failed to compile: ${err.message}`,
      err.stack,
      extractFailingLine(err.stack, srcLines),
    )
  }

  // Whatever has been printed so far, rendered the same way a successful run
  // renders it. Both failure paths below carry it out with them.
  const printedSoFar = (): string | undefined =>
    lines.length > 0 || skipped > 0 ? renderOutput(lines, skipped) : undefined

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ScriptError(
            `Script timed out after ${timeoutMs} ms`,
            undefined,
            undefined,
            true,
            printedSoFar(),
          ),
        ),
      timeoutMs,
    )
  })
  try {
    await Promise.race([fn(), timeout])
  } catch (e) {
    if (e instanceof ScriptError) throw e
    const err = e as Error
    throw new ScriptError(
      `Script threw: ${err.message}`,
      err.stack,
      extractFailingLine(err.stack, srcLines),
      false,
      printedSoFar(),
    )
  } finally {
    clearTimeout(timer)
  }

  return lines.length > 0 || skipped > 0 ? renderOutput(lines, skipped) : NO_PRINT_HINT
}
