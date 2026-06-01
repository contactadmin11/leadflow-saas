/**
 * LeadFlow Device Fingerprinting
 * ══════════════════════════════════════════════════════════════
 * Generates a stable device fingerprint using browser characteristics.
 * This fingerprint is:
 *  - Consistent for the same device/browser across sessions
 *  - Different for different devices/browsers
 *  - Stored in memory (not localStorage) for security
 *  - Sent as X-Device-ID header on every API request
 *
 * The server matches this against the stored session fingerprint.
 * If they don't match → the device is not authorized.
 */

(function () {
  'use strict';

  let _cachedFingerprint = null;
  let _cachedDeviceName  = null;

  /**
   * Get a readable device name like "Chrome on Windows"
   */
  function getDeviceName() {
    if (_cachedDeviceName) return _cachedDeviceName;

    const ua = navigator.userAgent;
    let browser = 'Browser';
    let os      = 'Unknown OS';

    // Browser detection
    if      (ua.includes('Edg/'))     browser = 'Edge';
    else if (ua.includes('OPR/'))     browser = 'Opera';
    else if (ua.includes('Chrome/'))  browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Firefox/')) browser = 'Firefox';

    // OS detection
    if      (ua.includes('Windows NT')) os = 'Windows';
    else if (ua.includes('Mac OS'))     os = 'Mac';
    else if (ua.includes('Android'))    os = 'Android';
    else if (ua.includes('iPhone'))     os = 'iPhone';
    else if (ua.includes('iPad'))       os = 'iPad';
    else if (ua.includes('Linux'))      os = 'Linux';

    _cachedDeviceName = `${browser} on ${os}`;
    return _cachedDeviceName;
  }

  /**
   * Generate a SHA-256 fingerprint from device characteristics.
   * Stable: same device + browser = same fingerprint across page loads.
   * Uses Web Crypto API (available in all modern browsers).
   */
  async function generateFingerprint() {
    if (_cachedFingerprint) return _cachedFingerprint;

    const components = [
      navigator.userAgent,
      navigator.language || '',
      navigator.languages?.join(',') || '',
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      new Date().getTimezoneOffset().toString(),
      (navigator.hardwareConcurrency || 0).toString(),
      navigator.platform || '',
      // Canvas fingerprint (unique per device/GPU/font rendering)
      await _canvasFingerprint(),
      // Audio fingerprint
      await _audioFingerprint(),
    ];

    const raw = components.join('|||');

    try {
      const encoder = new TextEncoder();
      const data    = encoder.encode(raw);
      const hashBuf = await crypto.subtle.digest('SHA-256', data);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      _cachedFingerprint = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback: simple hash if SubtleCrypto not available
      _cachedFingerprint = _simpleHash(raw);
    }

    return _cachedFingerprint;
  }

  /**
   * Canvas fingerprint — GPU/font rendering differences
   */
  async function _canvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font         = '14px Arial, sans-serif';
      ctx.fillStyle    = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle    = '#069';
      ctx.fillText('LeadFlow🎯', 2, 15);
      ctx.fillStyle    = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('LeadFlow🎯', 4, 17);
      return canvas.toDataURL().slice(-32);
    } catch { return ''; }
  }

  /**
   * Audio fingerprint — audio processing differences per device
   */
  async function _audioFingerprint() {
    try {
      if (!window.OfflineAudioContext) return '';
      const ctx  = new OfflineAudioContext(1, 44100, 44100);
      const osc  = ctx.createOscillator();
      const comp = ctx.createDynamicsCompressor();
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      const buffer = await ctx.startRendering();
      const data   = buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i += 100) sum += Math.abs(data[i]);
      return sum.toFixed(6);
    } catch { return ''; }
  }

  /**
   * Simple hash fallback (no SubtleCrypto)
   */
  function _simpleHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0').repeat(4).slice(0, 32);
  }

  // Expose globally
  window.LeadFlowDevice = {
    getFingerprint: generateFingerprint,
    getDeviceName,
    getDeviceInfo() {
      return {
        name:     getDeviceName(),
        userAgent: navigator.userAgent,
        screen:   `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform
      };
    }
  };

  // Pre-generate on load (async, no blocking)
  generateFingerprint().catch(() => {});

})();
