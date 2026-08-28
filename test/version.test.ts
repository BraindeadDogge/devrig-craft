import { describe, it, expect } from 'vitest'
import { SERVER_NAME } from '../src/version.js'

describe('scaffold', () => {
  it('exports the server name', () => {
    expect(SERVER_NAME).toBe('devrig-craft')
  })
})
