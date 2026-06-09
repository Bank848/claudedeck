import { describe, it, expect } from 'vitest'
import {
  buildInitialize,
  buildUserMessage,
  parseControlRequest,
  buildControlResponse,
  isResultEvent,
} from './permissionProtocol'

describe('buildInitialize', () => {
  it('emits a single-line initialize control_request', () => {
    const line = buildInitialize()
    expect(line).not.toContain('\n')
    const o = JSON.parse(line)
    expect(o.type).toBe('control_request')
    expect(o.request.subtype).toBe('initialize')
    expect(typeof o.request_id).toBe('string')
  })
})

describe('buildUserMessage', () => {
  it('puts the prompt ONLY in the message content, as one JSON line', () => {
    const nasty = 'list a & calc | echo "x" > y'
    const line = buildUserMessage(nasty)
    expect(line).not.toContain('\n')
    const o = JSON.parse(line)
    expect(o.type).toBe('user')
    expect(o.message.role).toBe('user')
    expect(o.message.content).toBe(nasty)
  })

  it('round-trips unicode (Thai) intact', () => {
    const o = JSON.parse(buildUserMessage('สวัสดี'))
    expect(o.message.content).toBe('สวัสดี')
  })
})

describe('parseControlRequest', () => {
  it('extracts id/tool/input/toolUseId from a can_use_tool request', () => {
    const evt = {
      type: 'control_request',
      request_id: 'abc-123',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        input: { file_path: 'x.txt', content: 'hi' },
        tool_use_id: 'toolu_1',
      },
    }
    expect(parseControlRequest(evt)).toEqual({
      id: 'abc-123',
      tool: 'Write',
      input: { file_path: 'x.txt', content: 'hi' },
      toolUseId: 'toolu_1',
    })
  })

  it('returns null for the initialize control_response and normal events', () => {
    expect(parseControlRequest({ type: 'control_response', response: { subtype: 'success' } })).toBeNull()
    expect(parseControlRequest({ type: 'assistant', message: {} })).toBeNull()
    expect(parseControlRequest({ type: 'result' })).toBeNull()
    expect(parseControlRequest(null)).toBeNull()
    expect(parseControlRequest({ type: 'control_request', request: { subtype: 'other' } })).toBeNull()
  })
})

describe('buildControlResponse', () => {
  it('builds an allow response carrying updatedInput, one JSON line', () => {
    const line = buildControlResponse('abc-123', 'allow', { input: { a: 1 } })
    expect(line).not.toContain('\n')
    const o = JSON.parse(line)
    expect(o.type).toBe('control_response')
    expect(o.response.subtype).toBe('success')
    expect(o.response.request_id).toBe('abc-123')
    expect(o.response.response).toEqual({ behavior: 'allow', updatedInput: { a: 1 } })
  })

  it('builds a deny response with a message', () => {
    const o = JSON.parse(buildControlResponse('abc-123', 'deny', { message: 'no' }))
    expect(o.response.response).toEqual({ behavior: 'deny', message: 'no' })
  })

  it('deny defaults to a generic message when none given', () => {
    const o = JSON.parse(buildControlResponse('id', 'deny'))
    expect(o.response.response.behavior).toBe('deny')
    expect(typeof o.response.response.message).toBe('string')
    expect(o.response.response.message.length).toBeGreaterThan(0)
  })
})

describe('isResultEvent', () => {
  it('is true only for the result event', () => {
    expect(isResultEvent({ type: 'result' })).toBe(true)
    expect(isResultEvent({ type: 'assistant' })).toBe(false)
    expect(isResultEvent(null)).toBe(false)
  })
})
