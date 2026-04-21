// All AddFurnitureModal styles. Rendered once at the root from index.tsx.

export const modalStyle = `
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }
  .modal-box {
    background: var(--color-panel-bg);
    border-radius: 14px;
    width: 100%;
    max-width: 520px;
    max-height: 90dvh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    overflow: hidden;
  }
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--color-border-custom);
    flex-shrink: 0;
  }
  .modal-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .modal-step-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-primary-brand);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .modal-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0;
  }
  .modal-close-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
  }
  .modal-close-btn:hover {
    background: var(--color-hover-bg);
    color: var(--color-text-primary);
  }
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .field-input {
    padding: 8px 10px;
    border: 1px solid var(--color-border-custom);
    border-radius: 8px;
    background: var(--color-input-bg);
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .field-input:focus {
    border-color: var(--color-primary-brand);
  }
  .field-textarea {
    resize: vertical;
    min-height: 72px;
  }
  .field-row-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  }
  .field-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .field-hint {
    font-size: 11px;
    margin: 0;
  }
  .field-hint.error { color: var(--color-error); }
  .field-hint.success { color: var(--color-success); }

  .screenshot-drop-zone {
    border: 2px dashed var(--color-border-custom);
    border-radius: 10px;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--color-text-secondary);
    background: var(--color-input-bg);
    transition: all 0.15s;
  }
  .screenshot-drop-zone:hover, .screenshot-drop-zone.dragging {
    border-color: var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
  }
  .screenshot-drop-title {
    font-size: 13px;
    font-weight: 600;
    margin-top: 4px;
  }
  .screenshot-drop-hint {
    font-size: 11px;
    opacity: 0.7;
  }
  .screenshot-preview-wrap {
    border: 1px solid var(--color-border-custom);
    border-radius: 10px;
    overflow: hidden;
    background: var(--color-card-bg);
  }
  .screenshot-preview-img {
    width: 100%;
    max-height: 180px;
    object-fit: contain;
    display: block;
    background: var(--color-input-bg);
  }
  .screenshot-preview-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-top: 1px solid var(--color-border-custom);
  }
  .screenshot-change-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-border-custom);
    background: none;
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .screenshot-change-btn:hover {
    border-color: var(--color-primary-brand);
    color: var(--color-primary-brand);
  }
  .extract-btn {
    padding: 6px 14px;
    font-size: 12px;
  }

  .url-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .url-icon {
    position: absolute;
    left: 9px;
    color: var(--color-text-secondary);
    pointer-events: none;
  }
  .url-input {
    width: 100%;
    padding: 8px 10px 8px 30px;
    border: 1px solid var(--color-border-custom);
    border-radius: 8px;
    background: var(--color-input-bg);
    font-size: 12px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
  }
  .url-input:focus { border-color: var(--color-primary-brand); }

  .style-pills-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .style-pill {
    padding: 4px 12px;
    border-radius: 6px;
    border: 1.5px solid var(--color-border-custom);
    background: transparent;
    font-size: 11px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: all 0.15s;
  }
  .style-pill.active {
    border-color: var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
  .btn-ghost {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .btn-ghost:hover { background: var(--color-hover-bg); }
  .btn-primary {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: var(--color-primary-brand);
    color: white;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-primary:hover:not(:disabled) { background: var(--color-primary-brand-hover); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Step 2 */
  .step2-hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;
  }
  .variants-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .variant-card {
    border: 1px solid var(--color-border-custom);
    border-radius: 10px;
    padding: 12px;
    background: var(--color-card-bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .variant-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .variant-num {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .variant-remove-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
  }
  .variant-remove-btn:hover {
    color: var(--color-error);
    background: rgba(229,77,66,0.08);
  }
  .variant-fields {
    display: flex;
    gap: 12px;
  }
  .variant-images-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .variant-image-thumb {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--color-hover-bg);
    border: 1px solid var(--color-border-custom);
  }
  .variant-image-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .variant-image-primary {
    position: absolute;
    top: 3px;
    left: 3px;
    background: var(--color-primary-brand);
    color: white;
    font-size: 8px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.3px;
  }
  .variant-image-thumb-actions {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px;
    background: rgba(0,0,0,0.55);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .variant-image-thumb:hover .variant-image-thumb-actions {
    opacity: 1;
  }
  .variant-image-reorder-btn,
  .variant-image-remove-btn {
    background: rgba(255,255,255,0.9);
    border: none;
    border-radius: 3px;
    font-size: 9px;
    color: var(--color-text-primary);
    cursor: pointer;
    padding: 2px 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }
  .variant-image-remove-btn:hover {
    background: var(--color-error);
    color: white;
  }
  .variant-image-add-btn {
    width: 72px;
    height: 72px;
    border-radius: 8px;
    border: 1.5px dashed var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 9px;
    font-weight: 600;
    transition: all 0.15s;
  }
  .variant-image-add-btn:hover:not(:disabled) {
    background: rgba(43, 168, 160, 0.12);
  }
  .variant-image-add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .variant-image-slot {
    width: 90px;
    flex-shrink: 0;
  }
  .variant-image-upload-btn {
    width: 90px;
    height: 90px;
    border-radius: 8px;
    border: 1.5px dashed var(--color-border-custom);
    background: var(--color-hover-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    color: var(--color-text-secondary);
    font-family: inherit;
    transition: all 0.15s;
  }
  .variant-image-upload-btn:hover {
    border-color: var(--color-primary-brand);
    color: var(--color-primary-brand);
    background: var(--color-primary-brand-light);
  }
  .variant-image-upload-btn span {
    font-size: 11px;
    font-weight: 600;
  }
  .variant-image-hint {
    font-size: 9px !important;
    font-weight: 400 !important;
    color: var(--color-text-secondary);
    text-align: center;
  }
  .variant-image-preview {
    width: 90px;
    height: 90px;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
    background: var(--color-hover-bg);
  }
  .variant-image-preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .variant-image-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }
  .success-overlay {
    background: rgba(76, 175, 130, 0.7);
    font-size: 24px;
    font-weight: 700;
  }
  .variant-text-fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .variant-error {
    font-size: 11px;
    color: var(--color-error);
    margin: 0;
  }
  .add-variant-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px;
    border-radius: 10px;
    border: 1.5px dashed var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
  }
  .add-variant-btn:hover {
    background: rgba(43, 168, 160, 0.12);
  }

  .flat-banner {
    display: flex;
    gap: 10px;
    padding: 12px;
    border-radius: 10px;
    background: var(--color-warning-bg);
    border: 1px solid rgba(245, 166, 35, 0.25);
  }
  .flat-banner-icon {
    color: var(--color-warning);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .flat-banner-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .flat-banner-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-warning-text);
    letter-spacing: 0.2px;
  }
  .flat-banner-text {
    font-size: 12px;
    color: var(--color-warning-text);
    line-height: 1.5;
  }
  .flat-banner-list {
    margin: 2px 0 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--color-warning-text);
    line-height: 1.55;
  }
  .flat-banner-list li {
    margin-bottom: 2px;
  }
  .flat-banner-prompt-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-warning-text);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
  }
  .flat-banner-prompt {
    display: block;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--color-text-primary);
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(245, 166, 35, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
`
