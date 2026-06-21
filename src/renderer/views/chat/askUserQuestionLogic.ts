/** Pure answer-resolution logic for AskUserQuestionPrompt, split out so the
 *  free-text "Other" substitution and multiSelect shaping can be unit-tested
 *  (the component itself renders JSX, which the node test env can't mount). */

export interface AskQuestion {
  question: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** Sentinel selection value for the free-text "Other" choice. */
export const OTHER = '__claudedeck_other__'

/** A question is answered when it has a selection, and any chosen "Other" has text. */
export function isAnswered(qi: number, selected: Record<number, string[]>, otherText: Record<number, string>): boolean {
  const sel = selected[qi] ?? []
  if (sel.length === 0) return false
  if (sel.includes(OTHER) && !(otherText[qi] ?? '').trim()) return false
  return true
}

/** Resolve one question's selections into its answer value, substituting otherText
 *  for the OTHER sentinel. Single-select returns a string; multiSelect an array. */
export function resolveAnswer(
  qi: number,
  q: AskQuestion,
  selected: Record<number, string[]>,
  otherText: Record<number, string>,
): string | string[] {
  const sel = selected[qi] ?? []
  const labels = sel
    .flatMap((l) => (l === OTHER ? [(otherText[qi] ?? '').trim()] : [l]))
    .filter(Boolean)
  return q.multiSelect ? labels : (labels[0] ?? '')
}

/** Build the full `answers` map keyed by question text. */
export function resolveAnswers(
  questions: AskQuestion[],
  selected: Record<number, string[]>,
  otherText: Record<number, string>,
): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {}
  questions.forEach((q, qi) => { answers[q.question] = resolveAnswer(qi, q, selected, otherText) })
  return answers
}
