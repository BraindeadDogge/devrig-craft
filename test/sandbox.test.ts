import { describe, it, expect } from 'vitest'
import { executeScript, ScriptError } from '../src/runtime/sandbox.js'

describe('executeScript', () => {
  it('returns only what the script prints', async () => {
    const out = await executeScript('print("a"); print("b", 42)', {}, 1000)
    expect(out).toBe('a\nb 42')
  })

  it('printJson pretty-prints', async () => {
    const out = await executeScript('printJson({ x: 1 })', {}, 1000)
    expect(out).toBe('{\n  "x": 1\n}')
  })

  it('printJson(undefined) prints "undefined", not an empty response', async () => {
    const out = await executeScript('printJson(undefined)', {}, 1000)
    expect(out).toBe('undefined')
  })

  it('supports top-level await and scope values', async () => {
    const out = await executeScript('await sleep(10); print(magic + 1)', { magic: 41 }, 1000)
    expect(out).toBe('42')
  })

  it('returns the HINT line for print-less success', async () => {
    const out = await executeScript('const x = 1', {}, 1000)
    expect(out).toContain('HINT: script completed but printed nothing')
  })

  it('truncates huge output from the middle, keeping the tail', async () => {
    const out = await executeScript('for (let i = 0; i < 5000; i++) print("line " + i)', {}, 5000)
    const lines = out.split('\n')
    expect(lines.length).toBeLessThan(2100)
    expect(out).toContain('[output truncated:')
    expect(lines[lines.length - 1]).toBe('line 4999')
    expect(lines[0]).toBe('line 0')
  })

  it('rejects with ScriptError carrying message and failing line', async () => {
    const code = 'print("ok")\nthrow new Error("boom")'
    const err = await executeScript(code, {}, 1000).then(
      () => null,
      (e) => e as ScriptError,
    )
    expect(err).toBeInstanceOf(ScriptError)
    expect(err!.message).toContain('boom')
    expect(err!.failingLine).toBe('line 2: throw new Error("boom")')
    expect(err!.timedOut).toBe(false)
  })

  it('reports syntax errors without crashing the process', async () => {
    await expect(executeScript('const const', {}, 1000)).rejects.toBeInstanceOf(ScriptError)
  })

  it('times out hung scripts and marks timedOut', async () => {
    const err = await executeScript('await sleep(5000)', {}, 100).then(
      () => null,
      (e) => e as ScriptError,
    )
    expect(err!.message).toMatch(/timed out after/)
    expect(err!.timedOut).toBe(true)
  })
})

describe('output survives a failing script', () => {
  it('a timed-out script still returns everything it printed', async () => {
    // Measured three times in one session: a fence that hit its timeout came
    // back with no output at all, so the run taught nothing and had to be
    // re-derived from the world state. The lines are the whole point of the
    // run — they must outlive the failure.
    const err = await executeScript(
      `print('phase one done')
       printJson({ placed: 42 })
       await sleep(5000)
       print('never reached')`,
      {},
      300,
    ).then(
      () => null,
      (e: unknown) => e as ScriptError,
    )
    expect(err, 'the script should have timed out').not.toBeNull()
    expect(err!.timedOut).toBe(true)
    expect(err!.output, 'the timeout must carry the output').toContain('phase one done')
    expect(err!.output).toContain('"placed": 42')
    expect(err!.output).not.toContain('never reached')
  })

  it('a script that throws still returns everything it printed', async () => {
    const err = await executeScript(
      `print('got this far')
       throw new Error('boom')`,
      {},
      5000,
    ).then(
      () => null,
      (e: unknown) => e as ScriptError,
    )
    expect(err).not.toBeNull()
    expect(err!.timedOut).toBe(false)
    expect(err!.output, 'a thrown script must carry its output too').toContain('got this far')
  })
})
