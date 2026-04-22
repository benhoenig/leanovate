export const canvasStyle = `
  .room-canvas {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background: var(--color-canvas-bg);
    touch-action: none;
  }
  .room-canvas.placement-mode {
    cursor: crosshair;
  }
  .room-canvas canvas {
    display: block;
  }
  .canvas-toggle-btn {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border-custom);
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(6px);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    z-index: 5;
  }
  .canvas-toggle-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-primary-brand);
  }
  .canvas-toggle-btn.active {
    background: var(--color-primary-brand);
    border-color: var(--color-primary-brand);
    color: white;
  }
  .grid-toggle-btn {
    bottom: 16px;
    left: 16px;
  }
  .mode-toggle-btn {
    top: 16px;
    right: 16px;
  }
  .export-view-btn {
    bottom: 16px;
    right: 16px;
  }
  .room-canvas.roam-mode {
    cursor: none;
  }
  .roam-hint {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 14px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 11px;
    font-weight: 500;
    z-index: 6;
    letter-spacing: 0.2px;
    pointer-events: none;
  }
  .roam-hint strong {
    font-weight: 700;
    color: #7FE5DE;
  }
  .wall-dim-labels-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
  }
  .wall-dim-label {
    position: absolute;
    left: 0;
    top: 0;
    padding: 3px 9px;
    border-radius: 999px;
    background: #FFFFFF;
    color: var(--color-primary-brand);
    border: 1.5px solid var(--color-primary-brand);
    font-size: 11px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.2px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
`
