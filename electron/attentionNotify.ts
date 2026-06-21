// NOTE: NotifyKind ('needsInput' | 'done') is DELIBERATELY separate from IndicatorKind
// ('needsInput' | 'error' | 'unread' | ...). A finished background turn maps to the 'unread'
// dot but the 'done' notification — do NOT pass an IndicatorKind here. The `else` below treats
// anything non-'needsInput' as done, so passing 'unread' would silently produce a done toast.
export type NotifyKind = 'needsInput' | 'done' | 'limitWarning'

/** Title + body for the OS notification (Thai-first, matches the in-app voice copy). */
export function notificationContent(kind: NotifyKind, name: string): { title: string; body: string } {
  if (kind === 'needsInput') {
    return { title: '🟠 รอคำตอบ', body: `${name} ต้องการคำตอบ` }
  }
  if (kind === 'limitWarning') {
    // `name` already carries the window + percent + reset detail from the renderer.
    return { title: '🔴 ใกล้ลิมิตการใช้งาน', body: name }
  }
  return { title: '🟢 เสร็จแล้ว', body: `${name} ทำงานเสร็จแล้ว` }
}
