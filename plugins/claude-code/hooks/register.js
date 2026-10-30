// deveggs scout as Claude Code's own subagent (a mod: Claude Code >= 2.1.287).
//
// On every prompt the developer submits, this code (not the model) starts a hidden
// `deveggs:deveggs-scout` subagent: Claude Code's own subagent, on its own model and login,
// with no tools and no CLAUDE.md. It reads the prompt, a short tail of the conversation and
// every egg and chicken, and names the ones that apply. Its answer is added to the prompt
// as context when it lands within WAIT_MS; otherwise it's appended to the conversation as
// soon as it does, so a slow scout never holds a prompt for long.
//
// deveggs itself writes the question and reads the answer (`deveggs scout --subagent
// spec|ask|verdict`, src/scout.ts), so the rules, the verdict check and the log are the same
// as every other harness's. While this mod is active, deveggs's UserPromptSubmit command
// hook (the fallback, `deveggs scout --hook`) sees `deveggs_scout: "subagent"` in its input
// and stays silent, so the context is never added twice. Anything that goes wrong here
// leaves the prompt as it was.

/** How long a prompt waits for the scout before it goes ahead without it (ms); DEVEGGS_SCOUT_WAIT_MS overrides it. */
const WAIT_MS = 5000
/** A hook gets 10 s of its own time and the wait counts: never wait past this (ms). */
const MAX_WAIT_MS = 7000
let waitMs = WAIT_MS
/** What the fallback command hook finds in its input while this mod scouts. */
const MARK = { deveggs_scout: 'subagent' }

/** The scout's agent type once registered (`deveggs:deveggs-scout`); undefined means don't scout. */
let scoutType
/** Answers being waited for, by the scout's agentId. */
const pending = new Map()
/** Every scout this session started and hasn't finished with, so its reports never reach the main conversation. */
const scouts = new Set()
/** Prompts this mod spawned a scout for, until the fallback hook's input is marked. */
const scouted = new Set()

/** The checkout's deveggs CLI: this plugin lives at <checkout>/plugins/claude-code. */
function deveggs($) {
  return $.plugin.root + '/../../bin/deveggs'
}

/** Run `deveggs scout <args>`, giving its stdout, or '' when anything fails. */
async function run($, args, stdin) {
  try {
    const r = await $.process.run([deveggs($), 'scout', ...args, '--harness', 'claude-code'], { stdin: stdin ?? '', timeoutMs: 10000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

/** The context the scout's answer injects ('' when nothing applies), logged by deveggs. */
async function verdict($, answer, ms, session) {
  const input = typeof answer === 'string' ? { reply: answer, ms, session } : { error: answer.error, unspawned: !!answer.unspawned, ms, session }
  return run($, ['--subagent', 'verdict'], JSON.stringify(input))
}

/** The conversation so far, as deveggs reads it: role and text, nothing else. */
async function history($) {
  try {
    const messages = await $.session.messages()
    return messages.slice(-40).map((m) => ({ role: m.role, text: m.text }))
  } catch {
    return []
  }
}

/**
 * The scout's answer landed (its report, or its turn ending). A prompt still waiting injects
 * it itself; otherwise it's appended to the conversation as soon as it lands. Once only.
 */
async function land($, agentId, answer) {
  const entry = pending.get(agentId)
  if (!entry) return
  pending.delete(agentId) // once only, whichever of handback, message or turn end comes first
  entry.answer = answer
  if (entry.waiting) {
    entry.resolve(answer)
    return
  }
  const context = await verdict($, answer, Date.now() - entry.t0, entry.session)
  if (!context) return
  try {
    const late = 'The deveggs scout answered after this turn began; apply these from your next step on.\n' + context
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: late }] } })
  } catch {
    // the session can't take it now
  }
}

/** A prompt the developer typed or sent (not a notification, a plugin's or a hidden one). */
function fromDeveloper(e) {
  const kind = e.origin && e.origin.kind
  return (kind === 'composer' || kind === 'bridge' || kind === 'sdk') && !e.isMeta && !e.command
}

/** A hook that fails leaves the event as it was (the prompt goes ahead unscouted). */
async function failOpen($, e, next) {
  return next(e)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      const raw = await $.env.get('DEVEGGS_SCOUT_WAIT_MS')
      const wait = raw ? Number(raw) : NaN
      waitMs = Number.isFinite(wait) && wait >= 0 ? Math.min(wait, MAX_WAIT_MS) : WAIT_MS
      const spec = JSON.parse(await run($, ['--subagent', 'spec']))
      const r = await $.agent.register({
        name: spec.name,
        description: spec.description,
        prompt: spec.prompt,
        model: spec.model,
        tools: [],
        omitClaudeMd: true,
        maxTurns: 1,
      })
      scoutType = r.agent
    } catch {
      scoutType = undefined // no deveggs, no basket: the fallback hook (if any) scouts instead
    }
    return next(e)
  })

  // Only this code starts the scout: the model never sees it in its list of agents.
  on('agent.offer', async ($, e, next) => (scoutType && e.agent === scoutType ? { isOffered: false } : next(e))).catch(failOpen)

  // Starting the scout is this code's own call, and the scout has no tools: in auto mode the
  // classifier would refuse it (no request asked for it), and in default mode it would ask.
  on('tool.check', async ($, e, next) => {
    const input = e.input && typeof e.input === 'object' ? e.input : {}
    const spawn = e.tool === 'Agent' || e.tool === 'Task'
    return scoutType && spawn && !e.agentId && input.subagent_type === scoutType ? { decision: 'allow', reason: 'deveggs scout: a tool-less subagent deveggs starts on every prompt' } : next(e)
  }).catch(failOpen)

  // Tell the fallback command hook this prompt is scouted here, so it prints nothing. Only a
  // prompt the mod really spawned a scout for: otherwise the fallback still runs. (Where hooks
  // on classic events don't run for this mod, `deveggs scout --subagent ask` also leaves a
  // per-session stamp the hook checks.)
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.prompt !== 'string' || !scouted.delete(e.prompt)) return next(e)
    return next({ ...e, ...MARK })
  }).catch(failOpen)

  on('prompt.submit', async ($, e, next) => {
    // A scout finishing is deveggs's business, not the main model's: drop its notice.
    const done = e.origin && e.origin.kind === 'task-notification' ? [...scouts].find((id) => e.text.includes(id)) : undefined
    if (done) {
      scouts.delete(done)
      return { drop: 'deveggs scout' }
    }
    if (!scoutType || !fromDeveloper(e)) return next(e)
    const t0 = Date.now()
    let session
    try {
      session = await $.session.id()
    } catch {
      session = undefined
    }
    const asked = await run($, ['--subagent', 'ask'], JSON.stringify({ prompt: e.text, messages: await history($), session }))
    let question
    try {
      question = JSON.parse(asked).question
    } catch {
      return next(e) // no basket, no candidates or no prompt
    }
    let spawned
    try {
      spawned = await $.agent.spawn({ subagentType: scoutType, prompt: question, description: 'deveggs scout' })
    } catch (err) {
      spawned = { deny: String(err) }
    }
    if (!spawned || !spawned.agentId) {
      // unspawned: deveggs takes back the stamp `ask` left, so the fallback hook scouts this prompt
      await verdict($, { error: 'spawn refused: ' + ((spawned && spawned.deny) || 'no agent'), unspawned: true }, Date.now() - t0, session)
      return next(e)
    }
    scouts.add(spawned.agentId)
    scouted.add(e.text)
    const entry = { t0, session, waiting: true }
    const answer = new Promise((resolve) => (entry.resolve = resolve))
    pending.set(spawned.agentId, entry)
    const budget = next.budget && typeof next.budget.remainingMs === 'number' ? next.budget.remainingMs - 1500 : waitMs
    const wait = Math.max(0, Math.min(waitMs, budget))
    let answered = await Promise.race([answer, new Promise((resolve) => setTimeout(() => resolve(undefined), wait))])
    entry.waiting = false // from here, a later answer is appended by land()
    if (answered === undefined) answered = entry.answer // landed in the same tick as the timeout
    if (answered === undefined) return next(e)
    const context = await verdict($, answered, Date.now() - t0, session)
    return context ? next({ ...e, context: [...(e.context ?? []), context] }) : next(e)
  }).catch(failOpen)

  // The scout hands its report back to the main conversation (its SubagentHandback tool, or
  // a message). deveggs reads it instead and answers the tool itself, so the main model gets
  // only the checked context, never the raw report.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId || !scouts.has(e.agentId) || e.tool !== 'SubagentHandback') return next(e)
    // A tool call's arguments sit beside `tool` on the event.
    await land($, e.agentId, typeof e.message === 'string' ? e.message : { error: 'the scout handed back no text' })
    return { result: { success: true, message: 'Report delivered to your caller.' } }
  }).catch(failOpen)

  on('session.send', async ($, e, next) => {
    if (!e.agentId || !scouts.has(e.agentId)) return next(e)
    await land($, e.agentId, e.text)
    return { isDelivered: false, reason: 'deveggs read the scout report' }
  }).catch(failOpen)

  on('session.receive', async ($, e, next) => (e.agentId && scouts.has(e.agentId) ? { consumed: 'deveggs scout' } : next(e))).catch(failOpen)

  on('turn.complete', async ($, e, next) => {
    if (e.agentId && pending.has(e.agentId)) {
      await land($, e.agentId, e.isAborted || typeof e.answer !== 'string' || !e.answer ? { error: 'the scout subagent ended without an answer' } : e.answer)
    }
    if (!e.agentId) scouted.clear() // a turn ended: no fallback hook is still to come for its prompt
    return next(e)
  })
}
