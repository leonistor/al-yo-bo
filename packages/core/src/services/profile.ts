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
import type { Profile } from '@al-yo-bo/shared';

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
      updateProfile(db, { ...patch, githubUsername });
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
