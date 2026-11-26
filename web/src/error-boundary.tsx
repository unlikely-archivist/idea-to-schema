import { Component, type ReactNode } from "react";

// React only catches render errors in class components, so this one has to be a class.
// The parent gives it a new key per revision, which clears the error for the next one.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <p role="alert">The preview couldn't be shown for this revision.</p>;
    }
    return this.props.children;
  }
}
