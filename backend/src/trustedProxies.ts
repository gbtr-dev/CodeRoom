/** Trust only configured proxy addresses; an empty list disables forwarded headers. */
export function trustedProxies(value: string = process.env.TRUSTED_PROXIES ?? '127.0.0.1,::1'): string[] {
  return value.split(',').map(address => address.trim()).filter(Boolean)
}
