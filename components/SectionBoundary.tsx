'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/lib/client-error-report'

/**
 * Renders nothing if a section of a page throws, and says so to the error log.
 *
 * Replaces a pattern three task-page sections used: the whole component body
 * inside `try { … return <jsx/> } catch { return null }`. That looked like a
 * safety net and was a partial one. It caught errors from expressions
 * evaluated while building the JSX, but not from any child component — React
 * renders those later, outside the try — and it swallowed what it did catch
 * without a trace. It also stopped the React Compiler from optimising the
 * component at all, which is how it was found.
 *
 * A boundary catches both kinds, and reports. The visible behaviour is
 * unchanged on purpose: a task whose log is malformed loses that one section,
 * not the page. DashboardErrorBoundary is the wrong tool here — it replaces
 * the whole screen and its reset clears localStorage, which is a response to
 * a broken app, not a broken paragraph.
 */
type Props = { name: string; children: ReactNode }
type State = { failed: boolean }

export default class SectionBoundary extends Component<Props, State> {
    public state: State = { failed: false }

    public static getDerivedStateFromError(): State {
        return { failed: true }
    }

    public componentDidCatch(error: Error, info: ErrorInfo) {
        // Best-effort, like every other client report: the section is already
        // gone, and nothing here should wait on or fail harder over this.
        void reportClientError(error, `section:${this.props.name}`, info.componentStack || undefined)
    }

    public render() {
        return this.state.failed ? null : this.props.children
    }
}
