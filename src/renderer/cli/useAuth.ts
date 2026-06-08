import { useCallback, useEffect, useReducer, useState } from 'react'
import { authReducer, initialAuthState } from './authReducer'
import * as auth from './authClient'
import { claudeAvailable } from './claudeClient'

export function useAuth() {
  const [state, dispatch] = useReducer(authReducer, initialAuthState)
  // GAP fix (review): surface "CLI not found" proactively, per the spec, rather
  // than only after a failed login click.
  const [cliAvailable, setCliAvailable] = useState(true)

  const refresh = useCallback(async () => {
    const status = await auth.status()
    dispatch({ type: 'set-status', status })
  }, [])

  useEffect(() => {
    void refresh()
    void claudeAvailable().then(setCliAvailable)
  }, [refresh])

  useEffect(() => {
    const offUrl = auth.onUrl(() => dispatch({ type: 'url' }))
    const offErr = auth.onError(({ text }) => dispatch({ type: 'login-error', text }))
    const offDone = auth.onDone(({ ok, error }) => {
      dispatch({ type: 'login-done', ok, error })
      if (ok) void refresh()
    })
    return () => {
      offUrl()
      offErr()
      offDone()
    }
  }, [refresh])

  const login = useCallback(async () => {
    dispatch({ type: 'login-start' })
    const r = await auth.startLogin()
    if (!r.ok) dispatch({ type: 'login-done', ok: false, error: r.error })
  }, [])

  const submitCode = useCallback(async (code: string) => {
    dispatch({ type: 'submit' })
    await auth.submitCode(code)
  }, [])

  const cancel = useCallback(async () => {
    await auth.cancelLogin()
    dispatch({ type: 'cancel' })
  }, [])

  const logout = useCallback(async () => {
    await auth.logout()
    await refresh()
  }, [refresh])

  return { ...state, cliAvailable, login, submitCode, cancel, logout, refresh }
}
