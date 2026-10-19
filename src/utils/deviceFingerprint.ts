import { SHA256 } from 'crypto-js';

/**
 * Device fingerprinting utility for generating unique device identifiers
 * This creates a hash based on various browser/device characteristics
 */

interface DeviceInfo {
  userAgent: string;
  language: string;
  platform: string;
  screenResolution: string;
  timezone: string;
  colorDepth: number;
  cookieEnabled: boolean;
  doNotTrack: string | null;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  deviceMemory?: number;
  webglFingerprint?: string;
  canvasFingerprint?: string;
}

/**
 * Generate a WebGL fingerprint
 */
function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;

    if (!gl) return 'no-webgl';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
    
    return `${vendor}-${renderer}`;
  } catch (e) {
    return 'webgl-error';
  }
}

/**
 * Generate a Canvas fingerprint
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return 'no-canvas';
    
    // Draw some text and shapes
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint test 🔒', 2, 2);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillRect(100, 5, 80, 20);
    
    return canvas.toDataURL();
  } catch (e) {
    return 'canvas-error';
  }
}

/**
 * Collect comprehensive device information
 */
function collectDeviceInfo(): DeviceInfo {
  const nav = navigator as any;
  
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorDepth: screen.colorDepth,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    deviceMemory: nav.deviceMemory,
    webglFingerprint: getWebGLFingerprint(),
    canvasFingerprint: getCanvasFingerprint()
  };
}

/**
 * Generate a unique device fingerprint
 * Returns a SHA256 hash of various device characteristics
 */
export function generateDeviceFingerprint(): string {
  const deviceInfo = collectDeviceInfo();
  
  // Create a string representation of all device characteristics
  const fingerprintData = [
    deviceInfo.userAgent,
    deviceInfo.language,
    deviceInfo.platform,
    deviceInfo.screenResolution,
    deviceInfo.timezone,
    deviceInfo.colorDepth.toString(),
    deviceInfo.cookieEnabled.toString(),
    deviceInfo.doNotTrack || 'null',
    deviceInfo.hardwareConcurrency.toString(),
    deviceInfo.maxTouchPoints.toString(),
    deviceInfo.deviceMemory?.toString() || 'unknown',
    deviceInfo.webglFingerprint || '',
    deviceInfo.canvasFingerprint || ''
  ].join('|');
  
  // Generate SHA256 hash
  const fingerprint = SHA256(fingerprintData).toString();
  
  // Add timestamp prefix for uniqueness (first 8 chars of current timestamp)
  const timestamp = Date.now().toString(36).slice(-8);
  
  return `${timestamp}-${fingerprint.slice(0, 32)}`;
}

/**
 * Get a simpler device identifier for mobile apps
 * This would typically be implemented differently for mobile platforms
 */
export function getMobileDeviceId(): string {
  // In a real mobile app, this would use platform-specific APIs
  // For web-based mobile access, we fall back to the fingerprint
  if (typeof window !== 'undefined' && window.navigator) {
    return generateDeviceFingerprint();
  }
  
  // For server-side or when navigator is not available
  return 'unknown-device';
}

/**
 * Validate if a device fingerprint matches the current device
 */
export function validateDeviceFingerprint(storedFingerprint: string): boolean {
  if (!storedFingerprint) return false;
  
  try {
    const currentFingerprint = generateDeviceFingerprint();
    
    // Extract the hash part (after the timestamp prefix)
    const storedHash = storedFingerprint.split('-').slice(1).join('-');
    const currentHash = currentFingerprint.split('-').slice(1).join('-');
    
    return storedHash === currentHash;
  } catch (error) {
    console.error('Error validating device fingerprint:', error);
    return false;
  }
}

/**
 * Get human-readable device information for display
 */
export function getDeviceDisplayInfo(): string {
  const deviceInfo = collectDeviceInfo();
  
  // Extract browser info from user agent
  let browser = 'Unknown Browser';
  const ua = deviceInfo.userAgent;
  
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Opera')) browser = 'Opera';
  
  // Extract OS info
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS')) os = 'iOS';
  
  return `${browser} on ${os} (${deviceInfo.screenResolution})`;
}
