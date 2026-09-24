import * as React from 'react';

// A plain React error boundary. It was Sentry's, set up with the DSN inherited from the USACO Guide fork, so every
// crash on this site (with its URL and browser details) was reported to the USACO Guide's Sentry project.
type State = { error: Error | null; componentStack: string };

export default class GlobalErrorBoundary extends React.Component<
  { children?: React.ReactNode },
  State
> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Caught error:', error, info);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mt-8 px-4">
        <div className="text-2xl md:text-4xl font-bold text-center">
          Възникна грешка
        </div>
        <pre className="font-mono max-w-5xl mx-auto overflow-x-auto mt-4">
          {error.toString()}
          {componentStack}
        </pre>
        <p className="mt-8 text-center">
          Можете да{' '}
          <a
            href="mailto:olympiads.xyz@gmail.com"
            target="_blank"
            className="text-blue-600 underline dark:text-blue-400"
            rel="noreferrer"
          >
            ни пишете
          </a>{' '}
          или да{' '}
          <a
            href="https://github.com/OlympiadsXYZ/olympiads-xyz/issues"
            target="_blank"
            className="text-blue-600 underline dark:text-blue-400"
            rel="noreferrer"
          >
            отворите issue в GitHub
          </a>
          . Опишете как да се стигне до грешката и добавете съобщението по-горе.
        </p>
        <div className="text-center mt-4">
          <button
            type="button"
            className="btn"
            onClick={() => this.setState({ error: null, componentStack: '' })}
          >
            Рестартирай приложението (или презаредете страницата)
          </button>
        </div>
      </div>
    );
  }
}
