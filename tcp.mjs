import net from 'node:net'

const err = (message, code) => Object.assign(new Error(message), { code })
const toBuf = (f) => (Buffer.isBuffer(f) ? f : Buffer.from(String(f), 'ascii'))

/**
 * Send raw frames (Buffers, or ASCII strings) to a console over TCP, paced so
 * the desk doesn't drop them. Used by the TCP drivers (Yamaha SCP, A&H MIDI).
 * @param frames Array<Buffer|string>
 * @returns {Promise<number>} count sent
 */
export function sendFrames(frames, host, port, { pace = 25, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port })
    let done = false
    const fail = (e) => {
      if (done) return
      done = true
      try {
        sock.destroy()
      } catch {
        /* already closed */
      }
      reject(e)
    }
    sock.setTimeout(timeout)
    sock.on('timeout', () => fail(err(`Timed out connecting to ${host}:${port}.`, 'timeout')))
    sock.on('error', () => fail(err(`Cannot reach the console at ${host}:${port}.`, 'no_desk')))
    sock.on('connect', () => {
      sock.setTimeout(0)
      let i = 0
      const next = () => {
        if (i >= frames.length) {
          sock.end()
          return
        }
        sock.write(toBuf(frames[i++]), (e) => {
          if (e) return fail(e)
          setTimeout(next, pace)
        })
      }
      next()
    })
    sock.on('close', () => {
      if (!done) {
        done = true
        resolve(frames.length)
      }
    })
  })
}
