import { describe, it, expect } from 'vitest'
import { OTHER, isAnswered, resolveAnswer, resolveAnswers, type AskQuestion } from './askUserQuestionLogic'

const single: AskQuestion = { question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }
const multi: AskQuestion = { question: 'Pick many', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true }

describe('isAnswered', () => {
  it('is false with no selection', () => {
    expect(isAnswered(0, {}, {})).toBe(false)
  })
  it('is true with a normal selection', () => {
    expect(isAnswered(0, { 0: ['A'] }, {})).toBe(true)
  })
  it('is false when Other is chosen but the text is blank', () => {
    expect(isAnswered(0, { 0: [OTHER] }, { 0: '   ' })).toBe(false)
  })
  it('is true when Other has text', () => {
    expect(isAnswered(0, { 0: [OTHER] }, { 0: 'custom' })).toBe(true)
  })
})

describe('resolveAnswer', () => {
  it('returns the picked label for single-select', () => {
    expect(resolveAnswer(0, single, { 0: ['A'] }, {})).toBe('A')
  })
  it('substitutes the free-text value for the Other sentinel', () => {
    expect(resolveAnswer(0, single, { 0: [OTHER] }, { 0: 'my answer' })).toBe('my answer')
  })
  it('returns an array for multiSelect, including resolved Other text', () => {
    expect(resolveAnswer(0, multi, { 0: ['X', OTHER] }, { 0: 'Z' })).toEqual(['X', 'Z'])
  })
  it('returns empty string when nothing resolves for single-select', () => {
    expect(resolveAnswer(0, single, { 0: [OTHER] }, { 0: '' })).toBe('')
  })
})

describe('resolveAnswers', () => {
  it('builds an answers map keyed by question text, with Other substituted', () => {
    const questions = [single, multi]
    const selected = { 0: [OTHER], 1: ['X', 'Y'] }
    const otherText = { 0: 'typed' }
    expect(resolveAnswers(questions, selected, otherText)).toEqual({
      'Pick one': 'typed',
      'Pick many': ['X', 'Y'],
    })
  })
})
