import { describe, it, expect } from 'vitest'
import { downloadFile } from './download'

// These reject inside the SSRF guard BEFORE any socket is opened, so no network
// is touched. The redirect-hop guard reuses the very same rejectUnsafeUrl at the
// recursive entry point, so it is covered by the same checks (HIGH-3).
describe('downloadFile SSRF guard', () => {
  it('rejects a non-https url', async () => {
    await expect(downloadFile('http://example.com/x', 'C:/tmp/x')).rejects.toThrow('only https allowed')
  })

  it('rejects the cloud metadata IP (would be a redirect target in the PoC)', async () => {
    await expect(downloadFile('https://169.254.169.254/latest/meta-data', 'C:/tmp/x'))
      .rejects.toThrow('host not allowed')
  })

  it('rejects a private-range host', async () => {
    await expect(downloadFile('https://10.0.0.5/model.pth', 'C:/tmp/x')).rejects.toThrow('host not allowed')
  })
})
