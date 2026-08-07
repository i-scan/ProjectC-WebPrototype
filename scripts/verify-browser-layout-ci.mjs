import { spawn } from 'node:child_process'

const maxAttempts = Number.parseInt(process.env.BROWSER_VERIFY_ATTEMPTS || '3', 10)
const retryDelayMs = Number.parseInt(process.env.BROWSER_VERIFY_RETRY_DELAY_MS || '2000', 10)

if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  throw new Error(`BROWSER_VERIFY_ATTEMPTS must be a positive integer; received ${process.env.BROWSER_VERIFY_ATTEMPTS}`)
}
if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
  throw new Error(`BROWSER_VERIFY_RETRY_DELAY_MS must be a non-negative integer; received ${process.env.BROWSER_VERIFY_RETRY_DELAY_MS}`)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function runVerifier() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/verify-browser-layout.mjs'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''

    const forward = (stream, target) => {
      stream.on('data', (chunk) => {
        const text = String(chunk)
        output += text
        target.write(text)
      })
    }

    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)
    child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.stack ?? error.message}` }))
    child.on('close', (code, signal) => resolve({
      code: code ?? 1,
      output: signal ? `${output}\nVerifier terminated by ${signal}` : output,
    }))
  })
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runVerifier()
  if (result.code === 0) process.exit(0)

  const chromeStartupFailure = result.output.includes('Chrome DevTools did not become ready')
  if (!chromeStartupFailure || attempt === maxAttempts) {
    process.exit(result.code)
  }

  console.warn(`Chrome startup was not ready; retrying browser verification (${attempt}/${maxAttempts}).`)
  if (retryDelayMs > 0) await sleep(retryDelayMs)
}
