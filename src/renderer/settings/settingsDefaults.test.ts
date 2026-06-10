import { describe, it, expect } from 'vitest'
import { DEFAULTS, withDefaults } from './SettingsContext'

describe('model-routing settings defaults + round-trip (Task 5)', () => {
  it('defaults are opt-in: routing off, resting opus, no always-confirm', () => {
    expect(DEFAULTS.modelRouting).toBe('off')
    expect(DEFAULTS.restingModel).toBe('opus-4-8')
    expect(DEFAULTS.routingAlwaysConfirm).toBe(false)
  })

  it('withDefaults fills the routing keys when absent from a partial load', () => {
    const s = withDefaults({ readAloud: true })
    expect(s.modelRouting).toBe('off')
    expect(s.restingModel).toBe('opus-4-8')
    expect(s.routingAlwaysConfirm).toBe(false)
  })

  it('withDefaults preserves stored routing values (round-trip)', () => {
    const s = withDefaults({ modelRouting: 'auto', restingModel: 'fable-5', routingAlwaysConfirm: true })
    expect(s.modelRouting).toBe('auto')
    expect(s.restingModel).toBe('fable-5')
    expect(s.routingAlwaysConfirm).toBe(true)
  })
})
