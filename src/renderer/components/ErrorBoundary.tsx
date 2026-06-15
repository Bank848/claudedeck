import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  stackOpen: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, copied: false, stackOpen: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('[ClaudeDeck crash]', error, errorInfo)
  }

  private buildReport(): string {
    const { error, errorInfo } = this.state
    const ts = new Date().toISOString()
    return [
      `ClaudeDeck Crash Report — ${ts}`,
      '',
      `Error: ${error?.name ?? 'Unknown'}: ${error?.message ?? ''}`,
      '',
      'Stack:',
      error?.stack ?? '(no stack)',
      '',
      'Component stack:',
      errorInfo?.componentStack ?? '(unavailable)',
    ].join('\n')
  }

  private copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(this.buildReport())
    this.setState({ copied: true })
    setTimeout(() => this.setState({ copied: false }), 2000)
  }

  private reload = (): void => window.location.reload()

  render(): ReactNode {
    const { error, errorInfo, copied, stackOpen } = this.state
    if (!error) return this.props.children

    const hasStack = !!(error.stack || errorInfo?.componentStack)

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          background: 'rgb(13 13 12)',
          color: 'rgb(250 249 245)',
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          padding: '32px',
          boxSizing: 'border-box',
          gap: '0',
        }}
      >
        {/* Icon + heading */}
        <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>💥</div>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: 20,
            fontWeight: 600,
            color: 'rgb(239 68 68)',
          }}
        >
          ClaudeDeck crashed
        </h1>
        <p
          style={{
            margin: '0 0 20px',
            color: 'rgb(168 165 158)',
            fontSize: 13,
            textAlign: 'center',
            maxWidth: 480,
          }}
        >
          A JavaScript error occurred in the renderer. Copy the report below and check the console for more details.
        </p>

        {/* Error box */}
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            background: 'rgb(22 22 21)',
            border: '1px solid rgb(58 56 53)',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: 'rgb(239 68 68)',
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {error.name}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: 'rgb(250 249 245)',
              wordBreak: 'break-all',
            }}
          >
            {error.message}
          </div>
        </div>

        {/* Expandable stack */}
        {hasStack && (
          <div
            style={{
              width: '100%',
              maxWidth: 640,
              marginBottom: 20,
            }}
          >
            <button
              onClick={() => this.setState({ stackOpen: !stackOpen })}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgb(168 165 158)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 0',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 10 }}>{stackOpen ? '▼' : '▶'}</span>
              Stack trace
            </button>

            {stackOpen && (
              <pre
                style={{
                  margin: 0,
                  padding: '12px 14px',
                  background: 'rgb(13 13 12)',
                  border: '1px solid rgb(42 41 38)',
                  borderRadius: 6,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: 'rgb(168 165 158)',
                  overflowX: 'auto',
                  overflowY: 'auto',
                  maxHeight: 260,
                  whiteSpace: 'pre',
                  lineHeight: 1.6,
                }}
              >
                {error.stack}
                {errorInfo?.componentStack && (
                  <>
                    {'\n\nComponent stack:'}
                    {errorInfo.componentStack}
                  </>
                )}
              </pre>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => void this.copy()}
            style={{
              padding: '8px 18px',
              background: 'rgb(31 30 29)',
              border: '1px solid rgb(58 56 53)',
              borderRadius: 6,
              color: copied ? 'rgb(34 197 94)' : 'rgb(250 249 245)',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              transition: 'color 0.15s',
            }}
          >
            {copied ? 'Copied!' : 'Copy report'}
          </button>
          <button
            onClick={this.reload}
            style={{
              padding: '8px 18px',
              background: 'rgb(217 119 87)',
              border: 'none',
              borderRadius: 6,
              color: 'rgb(250 249 245)',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            Reload app
          </button>
        </div>

        {/* Timestamp */}
        <p
          style={{
            position: 'absolute',
            bottom: 16,
            color: 'rgb(42 41 38)',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            margin: 0,
          }}
        >
          {new Date().toISOString()}
        </p>
      </div>
    )
  }
}
