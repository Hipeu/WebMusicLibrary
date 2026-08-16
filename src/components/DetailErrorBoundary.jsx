import { Component } from "react";

export default class DetailErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("专辑详情页渲染失败:", error);
    this.props.onRecover?.();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
