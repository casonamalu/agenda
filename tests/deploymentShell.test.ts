import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the static shell stays visible when the application bundle cannot start', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  assert.match(html, /Abriendo Agenda Casona Malú/)
  assert.match(html, /<noscript>/)
})

test('the deployed HTML is never reused with an obsolete asset hash', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const rootRule = config.headers.find((rule) => rule.source === '/')
  const cacheHeader = rootRule?.headers.find((header) => header.key === 'Cache-Control')

  assert.equal(cacheHeader?.value, 'no-cache, no-store, must-revalidate')
})


test('the production smoke test accepts the visible startup shell', () => {
  const workflow = readFileSync(new URL('../.github/workflows/automated-tests.yml', import.meta.url), 'utf8')

  assert.match(workflow, /grep --fixed-strings 'id="root"'/)
  assert.doesNotMatch(workflow, /grep --fixed-strings '<div id="root"><\/div>'/)
  assert.match(workflow, /curl --fail .*"\$origin\$asset_path"/)
})
