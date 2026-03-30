#!/usr/bin/env node

const http = require('http')

const PORT = 19191
const HOST = '127.0.0.1'

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : ''
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk) => (responseBody += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(responseBody) })
          } catch {
            resolve({ status: res.statusCode, data: responseBody })
          }
        })
      }
    )
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('OmniCue is not running. Start the app first.'))
      } else {
        reject(err)
      }
    })
    if (data) req.write(data)
    req.end()
  })
}

function parseDuration(input) {
  const trimmed = input.trim()
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/)
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])
  const minMatch = trimmed.match(/^(\d+)\s*m(?:in)?$/i)
  if (minMatch) return parseInt(minMatch[1]) * 60
  const secMatch = trimmed.match(/^(\d+)\s*s(?:ec)?$/i)
  if (secMatch) return parseInt(secMatch[1])
  const hourMatch = trimmed.match(/^(\d+)\s*h(?:r)?$/i)
  if (hourMatch) return parseInt(hourMatch[1]) * 3600
  const plainNum = trimmed.match(/^(\d+)$/)
  if (plainNum) return parseInt(plainNum[1]) * 60
  return null
}

function parseFlags(args) {
  const flags = {}
  const positional = []
  let i = 0
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true'
      flags[key] = val
      i += val === 'true' ? 1 : 2
    } else {
      positional.push(args[i])
      i++
    }
  }
  return { flags, positional }
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    console.log(`
  omnicue — CLI for OmniCue Desktop Timer

  Usage:
    omnicue notify <message> [--title <title>] [--timeout <seconds>]
    omnicue timer <duration> [name]
    omnicue health

  Examples:
    omnicue notify "Build complete"
    omnicue notify "Tests passed" --title "CI" --timeout 15
    omnicue timer 5m "Code review"
    omnicue timer 90s
    omnicue health
`)
    process.exit(0)
  }

  try {
    if (command === 'health') {
      const res = await request('GET', '/health')
      console.log(`✓ OmniCue is running (v${res.data.version || '?'})`)
    } else if (command === 'notify') {
      const { flags, positional } = parseFlags(args.slice(1))
      const message = positional.join(' ')
      if (!message) {
        console.error('Error: message is required. Usage: omnicue notify "Your message"')
        process.exit(1)
      }
      const body = { message }
      if (flags.title) body.title = flags.title
      if (flags.timeout) body.timeout = parseInt(flags.timeout)
      const res = await request('POST', '/notify', body)
      if (res.data.ok) {
        console.log(`✓ Notification sent`)
      } else {
        console.error(`Error: ${res.data.error}`)
        process.exit(1)
      }
    } else if (command === 'timer') {
      const restArgs = args.slice(1)
      if (restArgs.length === 0) {
        console.error('Error: duration is required. Usage: omnicue timer 5m "Optional name"')
        process.exit(1)
      }
      const duration = parseDuration(restArgs[0])
      if (!duration) {
        console.error(`Error: invalid duration "${restArgs[0]}". Use formats like 5m, 90s, 1:30`)
        process.exit(1)
      }
      const name = restArgs.slice(1).join(' ')
      const res = await request('POST', '/timer', { duration, name })
      if (res.data.ok) {
        console.log(`✓ Timer created (${restArgs[0]}${name ? `: ${name}` : ''})`)
      } else {
        console.error(`Error: ${res.data.error}`)
        process.exit(1)
      }
    } else {
      console.error(`Unknown command: ${command}. Run "omnicue --help" for usage.`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

main()
