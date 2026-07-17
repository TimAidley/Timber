import { describe, expect, it } from 'vitest';
import {
  changeStateFromReadout,
  compactStatus,
  computeLocationReadout,
  type LocationInputs,
} from '../src/state/location.js';

/** A fully-backed-up, published, clean object on a deployable host — the baseline. */
const CLEAN: LocationInputs = {
  storage: 'backed-up',
  hasLocalEdits: false,
  differsFromMain: false,
  newToMain: false,
  isPublic: true,
  canDeploy: true,
};

const readout = (over: Partial<LocationInputs>) => computeLocationReadout({ ...CLEAN, ...over });

describe('computeLocationReadout — host stop', () => {
  it('is absent for a device-only object (never committed)', () => {
    expect(readout({ storage: 'device' }).host).toBe('absent');
  });

  it('is behind while backed-up edits sit uncommitted locally', () => {
    expect(readout({ hasLocalEdits: true }).host).toBe('behind');
  });

  it('is current once backed-up edits have flushed to WIP', () => {
    expect(readout({ hasLocalEdits: false, differsFromMain: true }).host).toBe('current');
    expect(readout({}).host).toBe('current');
  });
});

describe('computeLocationReadout — website stop', () => {
  it('is no-deploy when the host cannot deploy, whatever else is true', () => {
    expect(readout({ canDeploy: false }).website).toBe('no-deploy');
    expect(readout({ canDeploy: false, isPublic: false, storage: 'device' }).website).toBe('no-deploy');
  });

  it('is draft when the page is not public (build skips it)', () => {
    expect(readout({ isPublic: false }).website).toBe('draft');
    // draft wins over "would otherwise be behind"
    expect(readout({ isPublic: false, differsFromMain: true }).website).toBe('draft');
  });

  it('is absent for a device-only public page (never reached the site)', () => {
    expect(readout({ storage: 'device' }).website).toBe('absent');
  });

  it('is absent for a public page added on WIP but never published', () => {
    expect(readout({ newToMain: true, differsFromMain: true }).website).toBe('absent');
  });

  it('is behind when a public page has unpublished changes (older version live)', () => {
    expect(readout({ differsFromMain: true }).website).toBe('behind');
    expect(readout({ hasLocalEdits: true }).website).toBe('behind');
  });

  it('is current when a public page matches the live site', () => {
    expect(readout({}).website).toBe('current');
  });
});

describe('computeLocationReadout — device stop', () => {
  it('is always current (the device holds your live edits)', () => {
    expect(readout({ storage: 'device' }).device).toBe('current');
    expect(readout({ hasLocalEdits: true }).device).toBe('current');
  });
});

describe('compactStatus', () => {
  it('reaches the website with nothing ahead when fully live', () => {
    expect(compactStatus(readout({}))).toEqual({ reached: 'website', ahead: false });
  });

  it('reaches the host and flags ahead when a public page has unpublished changes', () => {
    expect(compactStatus(readout({ differsFromMain: true }))).toEqual({ reached: 'host', ahead: true });
  });

  it('reaches the host without ahead for a backed-up draft (not meant for the site)', () => {
    expect(compactStatus(readout({ isPublic: false }))).toEqual({ reached: 'host', ahead: false });
  });

  it('reaches only the device (ahead) for a device-only object', () => {
    expect(compactStatus(readout({ storage: 'device' }))).toEqual({ reached: 'device', ahead: true });
  });

  it('reaches only the device (ahead) while local edits are uncommitted', () => {
    expect(compactStatus(readout({ hasLocalEdits: true }))).toEqual({ reached: 'device', ahead: true });
  });
});

describe('changeStateFromReadout (legacy bridge)', () => {
  it('maps a host-absent (device-only) object to editing', () => {
    expect(changeStateFromReadout(readout({ storage: 'device' }), 'clean')).toBe('editing');
  });

  it('passes the fallback through when the host has a copy', () => {
    expect(changeStateFromReadout(readout({ differsFromMain: true }), 'saved')).toBe('saved');
    expect(changeStateFromReadout(readout({}), 'clean')).toBe('clean');
  });
});
