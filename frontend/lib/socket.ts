import { io } from 'socket.io-client'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

export function createSocket() {
  return io(BACKEND_URL, {
    autoConnect: false,
    withCredentials: true,
  })
}