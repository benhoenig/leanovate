// Shared styles for the RightPanel subtree. Rendered once at the root
// (RightPanel/index.tsx) — do NOT duplicate inside child components.
// Child-specific styles (e.g. PlacementSection) live inline in their own
// component files.

export const panelStyle = `
  .right-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .rp-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border-custom);
    flex-shrink: 0;
  }
  .rp-tab {
    flex: 1;
    padding: 10px 0;
    border: none;
    background: none;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }
  .rp-tab:hover {
    color: var(--color-text-primary);
  }
  .rp-tab.active {
    color: var(--color-primary-brand);
    border-bottom-color: var(--color-primary-brand);
  }
  .rp-content {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
  }
  .empty-hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    opacity: 0.6;
    text-align: center;
    padding-top: 40px;
  }
  .panel-section {
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
  }
  .panel-divider {
    height: 1px;
    background: var(--color-border-custom);
  }
  .panel-input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--color-border-custom);
    border-radius: 7px;
    background: var(--color-input-bg);
    font-size: 12px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .panel-input:focus {
    border-color: var(--color-primary-brand);
  }
  .panel-input--name {
    font-weight: 600;
    font-size: 13px;
  }
  .dims-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .dim-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dim-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  /* Furniture properties */
  .fp-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fp-category {
    font-size: 10px;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: var(--color-hover-bg);
    padding: 2px 8px;
    border-radius: 4px;
    align-self: flex-start;
  }
  .fp-swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fp-swatch {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 2px solid var(--color-border-custom);
    cursor: pointer;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-hover-bg);
    padding: 0;
    transition: all 0.15s;
  }
  .fp-swatch:hover {
    transform: scale(1.08);
  }
  .fp-swatch.selected {
    border-color: var(--color-primary-brand);
    box-shadow: 0 0 0 1.5px var(--color-primary-brand);
  }
  .fp-swatch-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .fp-swatch-text {
    font-size: 9px;
    font-weight: 700;
    color: var(--color-text-secondary);
    text-transform: uppercase;
  }
  .fp-variant-name {
    font-size: 10px;
    color: var(--color-text-secondary);
  }
  .fp-price {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-primary-brand);
  }
  .fp-dims {
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .fp-scale-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 4px;
  }
  .fp-scale-label {
    font-size: 11px;
    color: var(--color-text-secondary);
    flex-shrink: 0;
    width: 28px;
  }
  .fp-scale-slider {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--color-border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .fp-scale-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-primary-brand);
    cursor: pointer;
  }
  .fp-scale-input-wrap {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }
  .fp-scale-input {
    width: 38px;
    padding: 2px 3px;
    font-size: 11px;
    text-align: right;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-input-bg, #F8F6F3);
    color: var(--color-text-primary);
    outline: none;
  }
  .fp-scale-input:focus {
    border-color: var(--color-primary-brand);
  }
  .fp-scale-pct {
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .fp-direction {
    font-size: 11px;
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }
  .fp-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-primary-brand);
    text-decoration: none;
  }
  .fp-link:hover {
    text-decoration: underline;
  }
  .fp-action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border-custom);
    background: var(--color-card-bg);
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fp-action-btn:hover {
    background: var(--color-hover-bg);
  }
  .fp-action-btn--danger {
    color: var(--color-error);
    border-color: rgba(229, 77, 66, 0.3);
  }
  .fp-action-btn--danger:hover {
    background: rgba(229, 77, 66, 0.08);
  }
  .fp-action-btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }

  /* Artwork (picture frame) panel */
  .fp-art-row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px;
    background: var(--color-card-bg);
    border: 1px solid var(--color-border-custom);
    border-radius: 8px;
    margin-bottom: 6px;
  }
  .fp-art-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
  }
  .fp-art-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fp-art-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fp-art-sub {
    font-size: 10px;
    color: var(--color-text-secondary);
  }
  .fp-art-empty {
    font-size: 11px;
    color: var(--color-text-secondary);
    font-style: italic;
    padding: 6px 0;
  }
  .fp-art-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Fixture controls */
  .fixture-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--color-text-secondary);
  }
  .fixture-row:hover {
    background: var(--color-hover-bg);
  }
  .fixture-row.selected {
    background: var(--color-primary-brand-light);
    border-color: var(--color-primary-brand);
    color: var(--color-text-primary);
  }
  .fixture-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fixture-meta {
    font-size: 10px;
    color: var(--color-text-secondary);
    margin-left: auto;
    text-transform: capitalize;
  }
  .fixture-delete {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: all 0.15s;
  }
  .fixture-row:hover .fixture-delete {
    opacity: 1;
  }
  .fixture-delete:hover {
    color: var(--color-error);
    background: rgba(229, 77, 66, 0.08);
  }

  /* Shape edit */
  .shape-edit-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1.5px solid var(--color-border-custom);
    background: var(--color-card-bg);
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .shape-edit-btn:hover {
    border-color: var(--color-primary-brand);
    color: var(--color-primary-brand);
  }
  .shape-edit-btn.active {
    border-color: var(--color-primary-brand);
    background: var(--color-primary-brand);
    color: white;
  }
  .vertex-count {
    margin-left: auto;
    font-size: 10px;
    font-weight: 500;
    opacity: 0.8;
  }
  .shape-reset-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid rgba(229, 77, 66, 0.3);
    background: transparent;
    color: var(--color-error);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .shape-reset-btn:hover {
    background: rgba(229, 77, 66, 0.08);
  }

  /* Curtain controls */
  .curtain-style-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
  }
  .curtain-style-btn {
    padding: 5px 0;
    border-radius: 6px;
    border: 1.5px solid var(--color-border-custom);
    background: var(--color-card-bg);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .curtain-style-btn:hover {
    border-color: var(--color-primary-brand);
    color: var(--color-primary-brand);
  }
  .curtain-style-btn.active {
    background: var(--color-primary-brand);
    border-color: var(--color-primary-brand);
    color: white;
  }
  .curtain-color-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .curtain-color-input {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .curtain-picker {
    width: 28px;
    height: 28px;
    border: 1.5px solid var(--color-border-custom);
    border-radius: 6px;
    padding: 1px;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }
  .curtain-hex {
    flex: 1;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    text-transform: uppercase;
  }
  .curtain-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .curtain-swatch {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 2px solid var(--color-border-custom);
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }
  .curtain-swatch:hover {
    transform: scale(1.12);
  }
  .curtain-swatch.selected {
    border-color: var(--color-primary-brand);
    box-shadow: 0 0 0 1.5px var(--color-primary-brand);
  }

  /* Lighting controls — preset row reuses .curtain-style-btn (same segmented
     look, same active primary-brand fill). Studio toggle reuses .shape-edit-btn.
     Sliders mirror .fp-scale-slider's rail + thumb for consistency. */
  .lighting-preset-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .lighting-slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lighting-slider-label {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .lighting-slider-value {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .lighting-slider-range {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--color-border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    margin: 0;
  }
  .lighting-slider-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-primary-brand);
    cursor: pointer;
    border: none;
  }
  .lighting-slider-range::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-primary-brand);
    cursor: pointer;
    border: none;
  }
  .lighting-slider-range:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .lighting-slider-range:disabled::-webkit-slider-thumb {
    cursor: not-allowed;
  }
`
