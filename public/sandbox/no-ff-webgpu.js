// Firefox's WebGPU backend SIGSEGVs the whole browser on some Linux / NVIDIA /
// Wayland setups (MozCrashReason "Queue ... does not exist"), and the VectoJS
// engine probes navigator.gpu on every Scene. Hide WebGPU on Firefox so the engine
// falls back to CPU / WebGL. Chromium keeps WebGPU. Must run before the engine loads.
(function () {
  if (!/firefox/i.test(navigator.userAgent)) return;
  try {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  } catch (e) {
    /* platform object refused the redefine — fall through to neuter requestAdapter */
  }
  try {
    if (navigator.gpu && navigator.gpu.requestAdapter) {
      navigator.gpu.requestAdapter = function () {
        return Promise.resolve(null);
      };
    }
  } catch (e) {
    /* WebGPU not present / locked down — nothing to do */
  }
})();
