class CryptoManager {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyCache = new Map();
    this.encryptionKey = null;
    this.storagePrefix = 'ib-api-key-';
  }

  async getEncryptionKey() {
    if (this.encryptionKey) return this.encryptionKey;

    const machineFingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      'idea-basin-v1',
    ].join('|');

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(machineFingerprint), 'PBKDF2', false, ['deriveKey']
    );

    let saltStr = localStorage.getItem('ib-encryption-salt');
    if (!saltStr) {
      const saltArray = crypto.getRandomValues(new Uint8Array(16));
      saltStr = Array.from(saltArray, b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('ib-encryption-salt', saltStr);
    }

    this.encryptionKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode(saltStr), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return this.encryptionKey;
  }

  async encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') throw new Error('Invalid plaintext');
    const key = await this.getEncryptionKey();
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedBase64) {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') throw new Error('Invalid encrypted data');
    const key = await this.getEncryptionKey();
    const binary = atob(encryptedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  }

  async setAPIKey(provider, apiKey) {
    if (!provider || !apiKey) throw new Error('Provider and API key required');
    const encrypted = await this.encrypt(apiKey);
    localStorage.setItem(`${this.storagePrefix}${provider}`, `enc:${encrypted}`);
    this.keyCache.set(provider, apiKey);
    return true;
  }

  async getAPIKey(provider) {
    if (!provider) return null;
    if (this.keyCache.has(provider)) return this.keyCache.get(provider);
    const stored = localStorage.getItem(`${this.storagePrefix}${provider}`);
    if (!stored) return null;
    if (stored.startsWith('enc:')) {
      try {
        const decrypted = await this.decrypt(stored.slice(4));
        this.keyCache.set(provider, decrypted);
        return decrypted;
      } catch {
        return null;
      }
    }
    // Legacy plaintext — migrate
    await this.setAPIKey(provider, stored);
    return stored;
  }

  hasAPIKey(provider) {
    if (this.keyCache.has(provider)) return true;
    const stored = localStorage.getItem(`${this.storagePrefix}${provider}`);
    return !!(stored && stored.length > 0);
  }

  removeAPIKey(provider) {
    localStorage.removeItem(`${this.storagePrefix}${provider}`);
    this.keyCache.delete(provider);
  }
}

export default new CryptoManager();
