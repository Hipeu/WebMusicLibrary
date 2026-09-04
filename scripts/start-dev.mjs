import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const pythonExecutable = process.env.PYTHON || (isWindows ? 'python' : 'python3')
const shutdownTimeoutMs = 4_000
const children = new Map()
let shuttingDown = false

const services = [
  {
    name: 'vite',
    port: 5173,
    command: process.execPath,
    args: [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')],
    cwd: projectRoot,
  },
  {
    name: 'backend',
    port: 8000,
    command: pythonExecutable,
    args: ['-m', 'uvicorn', 'main:app', '--reload', '--port', '8000'],
    cwd: path.join(projectRoot, 'backend'),
  },
  {
    name: 'qq-api',
    port: 3200,
    command: process.execPath,
    args: [
      '-r',
      path.join(projectRoot, 'qq-music-api-next', 'node_modules', 'ts-node', 'register', 'transpile-only.js'),
      path.join(projectRoot, 'qq-music-api-next', 'src', 'app.ts'),
    ],
    cwd: path.join(projectRoot, 'qq-music-api-next'),
  },
  {
    name: 'ncm-api',
    port: 3000,
    command: process.execPath,
    args: [path.join(projectRoot, 'ncm-api', 'app.js')],
    cwd: path.join(projectRoot, 'ncm-api'),
  },
]

function log(name, message, stream = process.stdout) {
  stream.write(`[${name}] ${message}\n`)
}

function pipeLines(stream, name, destination) {
  readline.createInterface({ input: stream }).on('line', (line) => log(name, line, destination))
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false)
      } else {
        reject(error)
      }
    })
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findWindowsPortOwner(port) {
  return new Promise((resolve) => {
    const child = spawn('netstat.exe', ['-ano', '-p', 'tcp'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.once('error', () => resolve(null))
    child.once('close', () => {
      const line = output
        .split(/\r?\n/)
        .find((candidate) => candidate.includes('LISTENING') && new RegExp(`:${port}\\s`).test(candidate))
      resolve(line?.trim().split(/\s+/).at(-1) || null)
    })
  })
}

async function assertPortsAvailable() {
  const conflicts = []
  for (const service of services) {
    if (!(await checkPort(service.port))) {
      const pid = isWindows ? await findWindowsPortOwner(service.port) : null
      conflicts.push(`${service.name} 端口 ${service.port}${pid ? `（PID ${pid}）` : ''}`)
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`以下端口已被占用，未启动任何服务：\n- ${conflicts.join('\n- ')}`)
  }
}

function runTaskkill(pid, force = false) {
  return new Promise((resolve) => {
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' })
    killer.once('error', () => resolve())
    killer.once('close', () => resolve())
  })
}

function processIsRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

async function stopChild(child, force = false) {
  if (!processIsRunning(child)) return
  if (isWindows) {
    await runTaskkill(child.pid, force)
    return
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function shutdown(exitCode, reason) {
  if (shuttingDown) return
  shuttingDown = true
  log('manager', `正在关闭全部服务（${reason}）...`)

  await Promise.all([...children.values()].map((child) => stopChild(child)))

  const deadline = Date.now() + shutdownTimeoutMs
  while ([...children.values()].some(processIsRunning) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const remaining = [...children.values()].filter(processIsRunning)
  if (remaining.length > 0) {
    log('manager', `强制清理 ${remaining.length} 个未退出的进程树...`, process.stderr)
    await Promise.all(remaining.map((child) => stopChild(child, true)))
  }

  process.exit(exitCode)
}

function startService(service) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(service.command, service.args, {
        cwd: service.cwd,
        detached: !isWindows,
        env: { ...process.env, MUSIC_API_CHECK_UPDATES: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }

    children.set(service.name, child)
    pipeLines(child.stdout, service.name, process.stdout)
    pipeLines(child.stderr, service.name, process.stderr)

    child.once('spawn', () => {
      log('manager', `${service.name} 已启动，PID ${child.pid}，端口 ${service.port}`)
      resolve()
    })
    child.once('error', (error) => {
      children.delete(service.name)
      log(service.name, `启动失败：${error.message}`, process.stderr)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      children.delete(service.name)
      if (!shuttingDown) {
        const detail = signal ? `信号 ${signal}` : `退出码 ${code}`
        log(service.name, `意外退出（${detail}）`, process.stderr)
        void shutdown(code || 1, `${service.name} 意外退出`)
      }
    })
  })
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => void shutdown(0, signal))
}
process.on('uncaughtException', (error) => {
  log('manager', error.stack || error.message, process.stderr)
  void shutdown(1, '未捕获异常')
})
process.on('unhandledRejection', (error) => {
  log('manager', error instanceof Error ? error.stack || error.message : String(error), process.stderr)
  void shutdown(1, '未处理的 Promise 拒绝')
})

try {
  await assertPortsAvailable()
  for (const service of services) {
    await startService(service)
  }
  log('manager', '全部服务已启动，按 Ctrl+C 统一关闭。')
} catch (error) {
  if (children.size > 0) {
    await shutdown(1, error.message)
  } else {
    log('manager', error.message, process.stderr)
    process.exitCode = 1
  }
}
