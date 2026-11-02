import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const core = join(root, 'core')
const wrapper = join(core, process.platform === 'win32' ? 'gradlew.bat' : './gradlew')

if (!existsSync(wrapper)) {
  console.error('Gradle wrapper not found in core/. Run: cd core && gradle wrapper')
  process.exit(1)
}

const windows = process.platform === 'win32'
const result = spawnSync(windows ? `"${wrapper}"` : wrapper, ['--quiet', 'fatJar'], {
  cwd: core,
  stdio: 'inherit',
  shell: windows
})

process.exit(result.status ?? 1)
