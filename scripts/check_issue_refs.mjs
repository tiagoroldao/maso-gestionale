/**
 * Warns about code comments that wait on a closed issue, such as
 * "until VAT codes exist (#17)" or "TODO(#22)": the work they wait for
 * landed, so the comment is probably stale. Only closed issues are
 * caught; a re-scoped issue stays open, so review checks those comments.
 * Pull requests are skipped; lookups that fail are counted, never flagged.
 * Warnings only; run in CI (annotations) or locally (`gh` auth or a token).
 */
import { execFileSync } from 'node:child_process'

const PATTERN = String.raw`(TODO|FIXME|until|once|when|later).*#[0-9]+`
const DIRS = ['app', 'inertia', 'shared', 'start', 'database/migrations', 'config']

let grep = ''
try {
  grep = execFileSync('git', ['grep', '-n', '-i', '-E', PATTERN, '--', ...DIRS], {
    encoding: 'utf8',
  })
} catch {
  // No matches
}

const hits = grep
  .split('\n')
  .filter(Boolean)
  .flatMap((line) => {
    const [file, lineNo, ...rest] = line.split(':')
    const text = rest.join(':')
    return [...text.matchAll(/#(\d+)/g)].map((m) => ({ file, lineNo, text, issue: m[1] }))
  })

const repo = process.env.GITHUB_REPOSITORY ?? 'tiagoroldao/maso-gestionale'
const token = process.env.GITHUB_TOKEN
const states = new Map()

async function stateOf(issue) {
  if (states.has(issue)) return states.get(issue)
  let state = 'unknown'
  if (token) {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    })
    if (response.ok) {
      const data = await response.json()
      state = data.pull_request ? 'pull request' : data.state
    }
  } else {
    try {
      const data = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/issues/${issue}`], { encoding: 'utf8' })
      )
      state = data.pull_request ? 'pull request' : data.state
    } catch {}
  }
  states.set(issue, state)
  return state
}

let stale = 0
let unknown = 0
for (const hit of hits) {
  const state = await stateOf(hit.issue)
  if (state === 'unknown') unknown++
  if (state !== 'closed') continue
  stale++
  const message = `Comment waits on closed issue #${hit.issue}: ${hit.text.trim()}`
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning file=${hit.file},line=${hit.lineNo}::${message}`)
  } else {
    console.log(`${hit.file}:${hit.lineNo}  ${message}`)
  }
}
console.log(
  `${hits.length} issue reference(s) in waiting comments: ${stale} on closed issues, ${unknown} not looked up.`
)
