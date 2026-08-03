import { useEffect, useRef } from "react";
import lottie from "lottie-web";
import animationData from "../assets/Audio playing animation.json";

export default function PlayingAnimation() {
  const containerRef = useRef(null);

  useEffect(() => {
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData,
    });

    return () => anim.destroy();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: 30,
        height: 30,
      }}
    />
  );
}
