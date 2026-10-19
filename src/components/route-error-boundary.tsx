import { Component, type ErrorInfo, type ReactNode } from "react";
import { getHashForView } from "@/lib/app-routes";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeKey: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render failed", { error, componentStack: info.componentStack });
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.error && previousProps.routeKey !== this.props.routeKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="flex min-h-[60vh] w-full items-center justify-center bg-[#0d0f10] p-6 text-zinc-100" role="alert">
        <div className="max-w-lg border border-rose-500/50 bg-rose-500/10 p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-rose-300">Tool unavailable</p>
          <h1 className="mt-3 text-2xl font-black">This page could not open.</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">The route failed while loading or rendering. Retry once; if it still fails, return to Market Lab and choose another tool.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 border border-rose-300 px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300">Retry page</button>
            <a href={getHashForView("work-gallery")} className="inline-flex min-h-11 items-center border border-zinc-600 px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300">Return to Market Lab</a>
          </div>
        </div>
      </section>
    );
  }
}
