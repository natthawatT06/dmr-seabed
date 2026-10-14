import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("DMR render error", error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal-error">
          <h1>ไม่สามารถแสดงหน้าเว็บได้</h1>
          <p>
            ลองโหลดหน้าเว็บอีกครั้ง หากยังพบปัญหาให้ตรวจการเชื่อมต่ออินเทอร์เน็ต
          </p>
          <button onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
        </main>
      );
    return this.props.children;
  }
}
