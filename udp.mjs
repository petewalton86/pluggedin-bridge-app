import dgram from 'node:dgram'
import { encode } from './osc.mjs'

/**
 * Send OSC messages to a console over UDP, paced so the desk doesn't drop them.
 * @param messages [{ address, args }]
 * @returns {Promise<number>} count sent
 */
export function sendMessages(messages, host, port, { pace = 25 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    sock.on('error', (err) => {
      try {
        sock.close()
      } catch {
        /* already closed */
      }
      reject(err)
    })
    let i = 0
    const next = () => {
      if (i >= messages.length) {
        sock.close()
        resolve(messages.length)
        return
      }
      const m = messages[i++]
      sock.send(encode(m.address, m.args), port, host, (err) => {
        if (err) {
          sock.close()
          reject(err)
          return
        }
        setTimeout(next, pace)
      })
    }
    next()
  })
}
