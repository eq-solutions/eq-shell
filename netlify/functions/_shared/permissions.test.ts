// Behavioural tests for can() — runs via `pnpm test` (node --test + tsx).
//
// Proves the Phase 2 chain end to end: a security group grants extra_perms,
// and can() honours those additive grants on top of the role matrix — resolved
// through @eq-solutions/roles (no local mirror). Also pins the platform-admin
// short-circuit and the guest-invite (no-role + extras) path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, type Principal } from './permissions.ts';

test('role matrix: manager has dispatch, employee does not', () => {
  assert.equal(can({ role: 'manager' }, 'field.dispatch'), true);
  assert.equal(can({ role: 'employee' }, 'field.dispatch'), false);
});

test('group grant: extra_perms widens an employee end to end', () => {
  // The employee role lacks field.dispatch; a security group grants it.
  const principal: Principal = { role: 'employee', extra_perms: ['field.dispatch'] };
  assert.equal(can(principal, 'field.dispatch'), true);
  // ...but only the granted perm — no blanket elevation.
  assert.equal(can(principal, 'entity.delete'), false);
});

test('group grant: stacks on top of the role, never narrows it', () => {
  const principal: Principal = { role: 'employee', extra_perms: ['reports.view'] };
  assert.equal(can(principal, 'reports.view'), true); // from the group
  assert.equal(can(principal, 'entity.view'), true);  // still from the role
});

test('platform admin short-circuits every perm, regardless of role', () => {
  const principal: Principal = { role: 'labour_hire', is_platform_admin: true };
  assert.equal(can(principal, 'entity.delete'), true);
  assert.equal(can(principal, 'admin.list_users'), true);
});

test('guest invite: no role, extras only', () => {
  const principal: Principal = { role: null, extra_perms: ['field.view'] };
  assert.equal(can(principal, 'field.view'), true);
  assert.equal(can(principal, 'entity.delete'), false);
});

test('invalid extra_perm keys are ignored, not granted', () => {
  // resolveEffectivePermissions validates against the real PermKey set, so a
  // stale/orphaned group key can never widen access.
  const principal: Principal = { role: 'employee', extra_perms: ['totally.bogus'] };
  assert.equal(can(principal, 'entity.view'), true); // role default intact
  // The bogus key grants nothing — and a real perm the role lacks stays denied.
  assert.equal(can(principal, 'field.dispatch'), false);
});

test('labour_hire base perms', () => {
  assert.equal(can({ role: 'labour_hire' }, 'field.view'), true);
  assert.equal(can({ role: 'labour_hire' }, 'quotes.view'), false);
});

test('empty / absent extras behave like role-only', () => {
  assert.equal(can({ role: 'supervisor', extra_perms: [] }, 'intake.commit'), true);
  assert.equal(can({ role: 'supervisor' }, 'intake.commit'), true);
  assert.equal(can({ role: 'apprentice' }, 'intake.commit'), false);
});
