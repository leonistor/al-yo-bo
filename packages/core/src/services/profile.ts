/**
 * The single user's profile (MODEL.md principle 8): a singleton identity row —
 * name, GitHub username, avatar file. No dataset pointer, no user axis, no
 * delete path. Transport-neutral like every service: avatar bytes arrive with
 * an injected write port (`AvatarStore`, mirroring `screenshotsDir`) so core
 * never touches paths — the app edge owns the data root and overwrites
 * `profile/avatar.<ext>`.
 */

import type { Database } from 'bun:sqlite';

import { getProfile, updateProfile } from '@al-yo-bo/db';
import type { DevProfile, Profile } from '@al-yo-bo/shared';

import { NotFoundError, ValidationError } from '../errors.ts';
import type { EventsSink } from '../events.ts';

/** Validated avatar bytes; the extension was sniffed from magic bytes, not trust. */
export interface AvatarFile {
  bytes: Uint8Array;
  ext: 'jpg' | 'png';
}

/**
 * Avatar file port: bytes go in, a stored file name comes out, and removal is
 * by that same name. Absent = avatar upload is rejected and clearing only drops
 * the DB pointer (profile still usable).
 */
export interface AvatarStore {
  /** Writes avatar bytes under the data root; returns the stored file name. */
  save(file: AvatarFile): Promise<string>;
  /** Removes a previously stored avatar; deleting a missing file is not an error. */
  remove(filename: string): Promise<void>;
}

export interface ProfileServiceDeps {
  db: Database;
  avatarStore?: AvatarStore;
  events: EventsSink;
}

export interface ProfilePatchInput {
  name?: string | null;
  githubUsername?: string | null;
  devProfile?: DevProfile | null;
  setupCompletedAt?: number | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function optionalStringField(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Validates a wizard questionnaire payload. Only `source` is required; all
 * other fields are optional and must match their declared shapes before they
 * reach the db JSON column.
 */
function validateDevProfile(value: unknown): DevProfile | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('devProfile must be an object or null');
  }
  const input = value as Record<string, unknown>;
  const source = input['source'];
  if (typeof source !== 'string' || source.trim() === '') {
    throw new ValidationError('devProfile.source must be a non-empty string');
  }
  const profile: DevProfile = { source };

  const focus = optionalStringField(input['focus']);
  if (focus !== undefined) {
    profile.focus = focus;
  }
  const experience = optionalStringField(input['experience']);
  if (experience !== undefined) {
    profile.experience = experience;
  }
  const notes = optionalStringField(input['notes']);
  if (notes !== undefined) {
    profile.notes = notes;
  }

  const languages = input['languages'];
  if (languages !== undefined) {
    if (!isStringArray(languages)) {
      throw new ValidationError('devProfile.languages must be an array of strings');
    }
    profile.languages = languages;
  }
  const frameworks = input['frameworks'];
  if (frameworks !== undefined) {
    if (!isStringArray(frameworks)) {
      throw new ValidationError('devProfile.frameworks must be an array of strings');
    }
    profile.frameworks = frameworks;
  }
  const tools = input['tools'];
  if (tools !== undefined) {
    if (!isStringArray(tools)) {
      throw new ValidationError('devProfile.tools must be an array of strings');
    }
    profile.tools = tools;
  }

  return profile;
}

function validateSetupCompletedAt(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('setupCompletedAt must be a number or null');
  }
  return value;
}

export interface ProfileService {
  /** The singleton row, or null only when the schema was tampered with. */
  get(): Profile | null;
  update(patch: ProfilePatchInput): Profile;
  saveAvatar(file: AvatarFile): Promise<Profile>;
  /** Drops the stored avatar file (if any) and the profile's pointer to it. */
  clearAvatar(): Promise<Profile>;
}

/** `ENOENT` from the store means the file is already gone — not a failure. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { db, avatarStore, events } = deps;

  const requireProfile = (): Profile => {
    const profile = getProfile(db);
    if (!profile) {
      // Migration 0001 inserts the sentinel singleton row; a missing row means
      // the schema was tampered with — surface it as 404, not a crash.
      throw new NotFoundError('Profile not found');
    }
    return profile;
  };

  return {
    get: () => getProfile(db),

    update(patch) {
      requireProfile();
      // People type "@user"; store the bare username the API contract promises.
      const githubUsername =
        patch.githubUsername === undefined || patch.githubUsername === null
          ? patch.githubUsername
          : patch.githubUsername.replace(/^@/, '');
      const dbPatch: { name?: string | null; githubUsername?: string | null; devProfile?: DevProfile | null; setupCompletedAt?: number | null } = {
        githubUsername,
      };
      if ('name' in patch) {
        dbPatch.name = patch.name;
      }
      if ('devProfile' in patch) {
        dbPatch.devProfile = validateDevProfile(patch.devProfile);
      }
      if ('setupCompletedAt' in patch) {
        dbPatch.setupCompletedAt = validateSetupCompletedAt(patch.setupCompletedAt);
      }
      updateProfile(db, dbPatch);
      const profile = requireProfile();
      events.emit({ topic: 'profile.changed' });
      return profile;
    },

    async saveAvatar(file) {
      requireProfile();
      if (!avatarStore) {
        throw new ValidationError('Avatar storage is not configured');
      }
      const avatarPath = await avatarStore.save(file);
      updateProfile(db, { avatarPath });
      const profile = requireProfile();
      events.emit({ topic: 'profile.changed' });
      return profile;
    },

    async clearAvatar() {
      const profile = requireProfile();
      if (!profile.avatarPath) {
        throw new NotFoundError('No avatar to remove');
      }
      if (avatarStore) {
        try {
          await avatarStore.remove(profile.avatarPath);
        } catch (error) {
          // A manually removed file still needs its dangling pointer cleared;
          // any other store failure (I/O, permissions) must surface.
          if (!isMissingFile(error)) {
            throw error;
          }
        }
      }
      updateProfile(db, { avatarPath: null });
      const updated = requireProfile();
      events.emit({ topic: 'profile.changed' });
      return updated;
    },
  };
}
