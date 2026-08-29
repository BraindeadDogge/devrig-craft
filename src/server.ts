import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPPORTED_RANGE, type DiscoveredWorld } from './discovery/types.js'
import { BotManager, type BotFactory, type BotLike } from './runtime/botManager.js'
import { executeScript, ScriptError } from './runtime/sandbox.js'
import { toWire } from './wire.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'

export type CraftServerDeps = {
  /** Fresh discovery snapshot per call — compose buildSnapshot + real sources in the CLI. */
  snapshot: () => Promise<DiscoveredWorld[]>
  botFactory: BotFactory
  recipesDir?: string
  feedbackPath?: string
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })
const json = (value: unknown) => ok(JSON.stringify(toWire(value), null, 2))

// Narrate into the game chat — the human is watching the bot live, and the
// running commentary IS the demo. Minecraft chat caps at 256 chars; never
// let a narration failure break the actual work.
function say(bot: BotLike, text: string): void {
  const chat = (bot as BotLike & { chat?: (t: string) => void }).chat
  if (!chat) return
  try {
    chat.call(bot, text.replace(/\s+/g, ' ').slice(0, 250))
  } catch (e) {
    console.error('chat narration failed:', e)
  }
}

export function createCraftServer(deps: CraftServerDeps): { server: McpServer; endAll: () => void } {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const bots = new BotManager(deps.botFactory)
  const issuedExecutions = new Set<string>()
  const feedbackPath = deps.feedbackPath ?? join(tmpdir(), 'devrig-craft-feedback.jsonl')

  server.registerTool(
    'craft_list_worlds',
    {
      description:
        'List running Minecraft worlds this machine can join: LAN-opened singleplayer worlds ' +
        '(any launcher, incl. Prism) and local offline-mode servers. Returns world_name — the ' +
        'routing key for every other tool — plus version, players and a compat flag. Rebuilt ' +
        'fresh on every call.',
      inputSchema: {},
    },
    async () => json(await deps.snapshot()),
  )

  server.registerTool(
    'craft_list_bots',
    {
      description:
        'List live bots and their readiness (joining/ready/error), position, health, food. ' +
        'Poll this after craft_join_world until state=ready.',
      inputSchema: {},
    },
    async () => json(bots.list()),
  )

  server.registerTool(
    'craft_join_world',
    {
      description:
        'ASYNC: start joining a discovered world as a bot. Returns immediately; poll ' +
        'craft_list_bots until state=ready before calling craft_execute_code. Joins time out ' +
        'after 60s into an error state.',
      inputSchema: {
        world_name: z.string().max(256).describe('routing key from craft_list_worlds'),
        username: z.string().max(16).optional().describe('bot username, default "devrig"'),
      },
    },
    async ({ world_name, username }) => {
      const worlds = await deps.snapshot()
      const world = worlds.find((w) => w.worldName === world_name)
      if (!world)
        return err(
          `Unknown world_name "${world_name}". Known: ${worlds.map((w) => w.worldName).join(', ') || '(none — is a world Open to LAN?)'}`,
        )
      if (!world.compatible)
        return err(
          `World "${world_name}" runs ${world.version ?? 'an unknown version'}; supported range is ${SUPPORTED_RANGE[0]}–${SUPPORTED_RANGE[1]}.`,
        )
      bots.join(world, username ?? 'devrig')
      return ok(
        `Joining "${world_name}" (${world.host}:${world.port}) as ${username ?? 'devrig'} — poll craft_list_bots until state=ready.`,
      )
    },
  )

  server.registerTool(
    'craft_execute_code',
    {
      description:
        'THE main tool. Execute JavaScript with the full mineflayer API in scope: bot (pathfinder ' +
        'loaded), Vec3, mcData, goals, Movements, Item, print/printJson/sleep/waitFor. No require, ' +
        'no import — everything you need is already in scope. The response is an execution_id line, ' +
        'then ONLY what the script prints. Read mcp-craft://prompt/skill first for recipes. Verify ' +
        'builds via bot.blockAt sweeps, not screenshots.',
      inputSchema: {
        world_name: z.string().max(256),
        code: z.string().max(100_000).describe('body of an async function; top-level await works'),
        task_id: z.string().max(256).describe('reuse across related calls to group audit logs'),
        reason: z
          .string()
          .max(4096)
          .describe(
            'what you are doing and why, in one human-readable sentence — it is SPOKEN INTO THE ' +
              'GAME CHAT as narration for the human watching, then logged',
          ),
        // A whole house is one call by design, and the phases measured at
        // 220s and counting — 600s was too tight to finish one. Still an
        // explicit ceiling, not an open door: an agent will eventually ask
        // for 999999.
        timeout: z
          .number()
          .int()
          .min(1)
          .max(3600)
          .optional()
          .describe('seconds, default 120, max 3600'),
      },
    },
    async ({ world_name, code, task_id, reason, timeout }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready')
        return err(
          `No ready bot in "${world_name}" (state: ${entry?.state ?? 'none'}). Call craft_join_world, then poll craft_list_bots until state=ready.`,
        )
      const release = bots.tryLock(world_name)
      if (!release) return err('bot busy: another script is running in this world — retry after it finishes')

      const executionId = randomUUID()
      issuedExecutions.add(executionId)
      say(entry.bot, `[devrig] ${reason}`)
      const started = Date.now()
      const audit = (okFlag: boolean) =>
        console.error(
          JSON.stringify({
            execution_id: executionId,
            task_id,
            reason,
            world_name,
            duration_ms: Date.now() - started,
            ok: okFlag,
          }),
        )
      try {
        const scope = craftScope(entry.bot)
        const output = await executeScript(code, scope, (timeout ?? 120) * 1000)
        audit(true)
        return ok(`execution_id: ${executionId}\n${output}`)
      } catch (e) {
        audit(false)
        if (e instanceof ScriptError && e.timedOut) {
          say(entry.bot, '[devrig] that script timed out — reconnecting and rethinking')
          try {
            entry.bot.end('devrig-craft: script timeout')
          } catch (endErr) {
            console.error('bot end after timeout failed:', endErr)
          }
          return err(
            [
              `execution_id: ${executionId}`,
              e.message,
              // The output is the point of the run: a build prints how far it
              // got, and a timeout that swallows that teaches nothing.
              e.output ? `--- printed before the timeout ---\n${e.output}` : undefined,
              'Bot disconnected to stop the runaway script — craft_join_world to rejoin.',
            ]
              .filter(Boolean)
              .join('\n'),
          )
        }
        if (e instanceof ScriptError) {
          say(entry.bot, `[devrig] hit a snag: ${e.message}`)
          return err(
            `execution_id: ${executionId}\n${[
              e.message,
              e.failingLine,
              e.scriptStack,
              e.output ? `--- printed before the error ---\n${e.output}` : undefined,
            ]
              .filter(Boolean)
              .join('\n')}`,
          )
        }
        throw e
      } finally {
        release()
      }
    },
  )

  server.registerTool(
    'craft_fetch_resource',
    {
      description:
        'Fetch an mcp-craft:// recipe article — copy-paste JS for building, world queries, ' +
        'command-based construction. Start at mcp-craft://prompt/skill.',
      inputSchema: { uri: z.string().max(512) },
    },
    async ({ uri }) => {
      const article = await loadRecipe(deps.recipesDir, uri)
      return article
        ? ok(article)
        : err(`Unknown URI "${uri}". Known: ${(await listRecipeUris(deps.recipesDir)).join(', ')}`)
    },
  )

  server.registerTool(
    'craft_chat',
    {
      description:
        'HEAVY/debug: send one raw chat line or slash-command. Prefer craft_execute_code with ' +
        'bot.chat(...) so sends compose with logic and verification.',
      inputSchema: {
        world_name: z.string().max(256),
        text: z.string().max(256),
        task_id: z.string().max(256),
        reason: z.string().max(4096),
      },
    },
    async ({ world_name, text }) => {
      const entry = bots.get(world_name)
      if (!entry || entry.state !== 'ready') return err(`No ready bot in "${world_name}".`)
      const release = bots.tryLock(world_name)
      if (!release) return err('bot busy: another script is running in this world — retry after it finishes')
      try {
        ;(entry.bot as BotLike & { chat: (t: string) => void }).chat(text)
        return ok('sent')
      } finally {
        release()
      }
    },
  )

  server.registerTool(
    'craft_take_screenshot',
    {
      description:
        'HEAVY ENDPOINT: render the bot POV. Not available on this install (headless GL) — for ' +
        'verification use craft_execute_code with bot.blockAt sweeps ' +
        '(mcp-craft://skill/world-queries); the human watches the world first-person anyway.',
      inputSchema: {
        world_name: z.string().max(256),
        task_id: z.string().max(256),
        reason: z.string().max(4096),
      },
    },
    async () =>
      err(
        'screenshot rendering is not available on this install — verify via bot.blockAt sweeps (mcp-craft://skill/world-queries); the human is watching first-person anyway',
      ),
  )

  server.registerTool(
    'craft_execute_feedback',
    {
      description:
        'Rate a prior craft_execute_code call 0.00–1.00 with an explanation. Requires the ' +
        'execution_id that call returned.',
      inputSchema: {
        task_id: z.string().max(256),
        execution_id: z.string().max(64),
        success_rating: z.number().min(0).max(1),
        explanation: z.string().max(4096),
      },
    },
    async (args) => {
      if (!issuedExecutions.has(args.execution_id))
        return err(`Unknown execution_id "${args.execution_id}" — pass the id returned by craft_execute_code.`)
      await appendFile(feedbackPath, JSON.stringify({ ...args, ts: new Date().toISOString() }) + '\n', 'utf8')
      return ok(`recorded to ${feedbackPath}`)
    },
  )

  return { server, endAll: () => bots.endAll() }
}

function craftScope(bot: BotLike): Record<string, unknown> {
  const scopeFn = (bot as BotLike & { craftScope?: () => Record<string, unknown> }).craftScope
  if (scopeFn) return scopeFn()
  // Test bots without a factory-attached scope: expose the bot plus a generic waitFor.
  return {
    bot,
    waitFor: (event: string, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`waitFor("${event}") timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
        bot.once(event, (...args: unknown[]) => {
          clearTimeout(t)
          resolve(args)
        })
      }),
  }
}

async function loadRecipe(recipesDir: string | undefined, uri: string): Promise<string | null> {
  if (!recipesDir) return null
  const rel = uri.replace(/^mcp-craft:\/\//, '')
  if (!/^[a-z0-9/-]+$/.test(rel)) return null
  try {
    return await readFile(join(recipesDir, `${rel}.md`), 'utf8')
  } catch {
    return null
  }
}

async function listRecipeUris(recipesDir: string | undefined): Promise<string[]> {
  if (!recipesDir) return []
  const uris: string[] = []
  for (const dir of ['prompt', 'skill']) {
    const files = await readdir(join(recipesDir, dir)).catch(() => [] as string[])
    uris.push(...files.map((f) => `mcp-craft://${dir}/${f.replace(/\.md$/, '')}`))
  }
  return uris
}
