import { describe, expect, it } from 'vitest';
import { getStoredJson, getStoredString, setStoredJson, setStoredString, storageKeys } from '../../src/lib/storage';

describe('storage utility', () => {
  it('stores and retrieves string values', () => {
    setStoredString(storageKeys.activeSidebarTab, 'media');
    expect(getStoredString(storageKeys.activeSidebarTab)).toBe('media');
  });

  it('stores and retrieves json values', () => {
    const key = 'qc_test_json_key';
    setStoredJson(key, { a: 1, b: 'ok' });
    expect(getStoredJson<{ a: number; b: string }>(key)).toEqual({ a: 1, b: 'ok' });
  });

  it('returns null for malformed json', () => {
    const key = 'qc_bad_json';
    localStorage.setItem(key, '{bad-json');
    expect(getStoredJson(key)).toBeNull();
  });

  it('uses namespaced keys', () => {
    expect(storageKeys.activeSidebarTab.startsWith('qc_')).toBe(true);
    expect(storageKeys.uiCollapse('panel').startsWith('qc_')).toBe(true);
  });
});
