import { Component, type ReactNode } from 'react';

/** Shows the error instead of a blank page if rendering crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Sci-Synth crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box" style={{ margin: 40 }}>
        <h3 style={{ marginTop: 0 }}>⚠ Sci-Synth hit an error</h3>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button className="btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
