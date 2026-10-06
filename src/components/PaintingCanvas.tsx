import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { WebGLPaintingRenderer, ShaderUniforms } from '../utils/webglHelper';
import { computeLightPosition, TrajectoryMode } from '../utils/lightTrajectories';
import defaultArtwork from '../assets/images/sculptural_painting_1791202884470.jpg';

export interface PaintingCanvasProps {
  loopDuration: number;
  trajectoryMode: TrajectoryMode;
  lightIntensity: number;
  beamRadius: number;
  impastoDepth: number;
  breezeStrength: number;
  ambientLevel: number;
  isPlaying: boolean;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  interactiveTorch: boolean;
  viewScale?: number;
}

export interface PaintingCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
  captureFrame: () => string | null;
  seek: (time: number) => void;
}

export const PaintingCanvas = forwardRef<PaintingCanvasHandle, PaintingCanvasProps>(
  (
    {
      loopDuration,
      trajectoryMode,
      lightIntensity,
      beamRadius,
      impastoDepth,
      breezeStrength,
      ambientLevel,
      isPlaying,
      currentTime,
      onTimeUpdate,
      interactiveTorch,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<WebGLPaintingRenderer | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const lastTimestampRef = useRef<number | null>(null);
    const timeRef = useRef<number>(currentTime);
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Interactive mouse / touch coordinates (normalized [0, 1])
    const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
    const isInteractingRef = useRef(false);

    // Keep timeRef in sync with external currentTime when paused / seeking
    useEffect(() => {
      timeRef.current = currentTime;
    }, [currentTime]);

    // Expose handle methods for recorder and stills
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
      captureFrame: () => {
        if (!canvasRef.current) return null;
        return canvasRef.current.toDataURL('image/jpeg', 0.95);
      },
      seek: (t: number) => {
        timeRef.current = t % loopDuration;
        renderCurrentFrame();
      },
    }));

    // Render single frame given current state
    const renderCurrentFrame = useCallback(() => {
      if (!rendererRef.current || !canvasRef.current) return;

      const effectiveTrajectory = interactiveTorch && pointerPos ? 'interactive' : trajectoryMode;
      const light = computeLightPosition(
        effectiveTrajectory,
        timeRef.current,
        loopDuration,
        pointerPos || undefined
      );

      const uniforms: ShaderUniforms = {
        time: timeRef.current,
        loopDuration,
        lightPos: [light.x, light.y, light.z],
        lightIntensity: lightIntensity * light.intensityFactor,
        beamRadius,
        impastoDepth,
        breezeStrength,
        ambientLevel,
        specularPower: 38.0,
        specularStrength: 1.15,
        resolution: [canvasRef.current.width, canvasRef.current.height],
      };

      rendererRef.current.render(uniforms);
    }, [
      interactiveTorch,
      pointerPos,
      trajectoryMode,
      loopDuration,
      lightIntensity,
      beamRadius,
      impastoDepth,
      breezeStrength,
      ambientLevel,
    ]);

    // Initialize WebGL and Load Texture
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Internal rendering buffer for crisp 9:16 vertical resolution
      // Standard Spotify Canvas is 720x1280 or 1080x1920
      const width = 1080;
      const height = 1920;
      canvas.width = width;
      canvas.height = height;

      const renderer = new WebGLPaintingRenderer(canvas);
      rendererRef.current = renderer;

      // Primary texture path from bundled image asset with fallback to /artwork.jpg
      const primaryPath = defaultArtwork || '/artwork.jpg';

      renderer
        .loadTexture(primaryPath)
        .then((success) => {
          if (success) {
            setIsLoaded(true);
            renderCurrentFrame();
          } else {
            // Try public directory fallback
            renderer.loadTexture('/artwork.jpg').then(() => {
              setIsLoaded(true);
              renderCurrentFrame();
            });
          }
        })
        .catch(() => {
          setIsLoaded(true);
          renderCurrentFrame();
        });

      return () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
        }
        renderer.destroy();
      };
    }, []);

    // Main animation loop
    useEffect(() => {
      if (!isLoaded) return;

      if (!isPlaying) {
        lastTimestampRef.current = null;
        renderCurrentFrame();
        return;
      }

      let active = true;

      const tick = (now: number) => {
        if (!active) return;

        if (lastTimestampRef.current !== null) {
          const delta = (now - lastTimestampRef.current) / 1000;
          // Advance time and wrap around seamless loopDuration
          timeRef.current = (timeRef.current + delta) % loopDuration;
          onTimeUpdate(timeRef.current);
        }
        lastTimestampRef.current = now;

        renderCurrentFrame();

        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);

      return () => {
        active = false;
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
        }
      };
    }, [isPlaying, isLoaded, loopDuration, onTimeUpdate, renderCurrentFrame]);

    // Handle pointer interactions for tactile spotlight exploration
    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactiveTorch && !isInteractingRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
      setPointerPos({ x, y });
      if (!isPlaying) {
        renderCurrentFrame();
      }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      isInteractingRef.current = true;
      handlePointerMove(e);
    };

    const handlePointerUp = () => {
      isInteractingRef.current = false;
      if (!interactiveTorch) {
        setPointerPos(null);
      }
    };

    return (
      <div
        className="relative w-full h-full flex items-center justify-center select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Loading state indicator */}
        {!isLoaded && !loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950 z-20">
            <div className="w-12 h-12 rounded-full border-2 border-neutral-700 border-t-neutral-200 animate-spin mb-4" />
            <span className="text-xs uppercase tracking-[0.25em] text-neutral-400 font-medium">
              Initializing Impasto Canvas...
            </span>
          </div>
        )}

        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950 text-red-400 p-6 z-20 text-center text-sm">
            <p className="font-semibold mb-2">Canvas Load Error</p>
            <p className="text-neutral-500 text-xs">{loadError}</p>
          </div>
        )}

        {/* The 9:16 Canvas */}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain cursor-crosshair rounded-none shadow-2xl"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: '9 / 16',
          }}
        />

        {/* Ambient subtle vignette overlay to enhance museum chiaroscuro depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 50%, transparent 65%, rgba(0, 0, 0, 0.45) 100%)',
          }}
        />
      </div>
    );
  }
);

PaintingCanvas.displayName = 'PaintingCanvas';
