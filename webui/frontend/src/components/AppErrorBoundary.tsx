import { Component, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-error">
          <h1>页面加载失败</h1>
          <p>{this.state.error.message}</p>
          <button type="button" className="primary" onClick={() => window.location.assign('/')}>
            返回总览
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
