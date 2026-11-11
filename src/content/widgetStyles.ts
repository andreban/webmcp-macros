/** Styles live inside the widget's closed shadow root, isolated from the page. */
export const widgetStyles = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, sans-serif; }
.wmm-root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; color: #1f2328; font-size: 13px; }
.wmm-launcher {
  width: 32px; height: 32px; border-radius: 50%; border: 1px solid #d0d7de; background: #fff; color: #1f2328;
  cursor: pointer; display: grid; place-items: center; font-size: 15px; padding: 0; margin-left: auto;
  box-shadow: 0 1px 4px rgba(0,0,0,.18); opacity: .75; animation: wmm-in .15s ease-out; position: relative;
}
.wmm-launcher:hover, .wmm-launcher:focus-visible { opacity: 1; }
.wmm-badge {
  position: absolute; top: -4px; right: -4px; min-width: 14px; height: 14px; border-radius: 7px; padding: 0 3px;
  background: #1f6feb; color: #fff; font-size: 10px; line-height: 14px; text-align: center;
}
.wmm-panel {
  width: 280px; max-height: 70vh; overflow: auto; margin-bottom: 8px; padding: 12px; border-radius: 10px;
  border: 1px solid #d0d7de; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18);
}
.wmm-title { font-weight: 600; margin: 0 0 8px; font-size: 13px; }
.wmm-macro { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; }
.wmm-macro + .wmm-macro { border-top: 1px solid #eaeef2; }
.wmm-macro small { display: block; color: #656d76; }
.wmm-field { display: block; margin-bottom: 8px; }
.wmm-field span { display: block; margin-bottom: 2px; color: #656d76; }
input:not([type=checkbox]), select { width: 100%; padding: 5px 6px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 13px; background: #fff; color: inherit; }
.wmm-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
button { font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid #1f6feb; background: #1f6feb; color: #fff; cursor: pointer; }
button.wmm-secondary { background: #fff; color: #1f2328; border-color: #d0d7de; }
.wmm-status { margin: 0; overflow-wrap: anywhere; }
.wmm-status.failed { color: #cf222e; }
@keyframes wmm-in { from { opacity: 0; } to { opacity: .75; } }
@media (prefers-reduced-motion: reduce) { .wmm-launcher { animation: none; } }
@media (prefers-color-scheme: dark) {
  .wmm-root { color: #e6edf3; }
  .wmm-launcher, .wmm-panel, button.wmm-secondary, input:not([type=checkbox]), select { background: #161b22; border-color: #30363d; color: #e6edf3; }
  .wmm-macro + .wmm-macro { border-color: #30363d; }
  .wmm-macro small, .wmm-field span { color: #8d96a0; }
  .wmm-status.failed { color: #ff7b72; }
}
`;
