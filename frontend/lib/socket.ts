import { io } from 'socket.io-client'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

export function createSocket() {
  const url = new URL(BACKEND_URL)
  const hasPrefix = url.pathname !== '/'
  return io(url.origin, {
    path: hasPrefix ? `${url.pathname}/socket.io` : '/socket.io',
    autoConnect: false,
    withCredentials: true,
  })
}