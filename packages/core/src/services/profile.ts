/**
 * The single user's profile (identity + active-dataset pointer). Transport-
 * neutral like every service: avatar bytes arrive with an injected write port
 * (`AvatarStore`, mirroring `screenshotsDir`) so core never touches paths —
 * the app edge owns the data root and overwrites `profile/avatar.<ext>`.
 */

import type { Database } from 'bun:sqlite';

import { getDatasetById, getProfile, updateProfile } from '@al-yo-bo/db';
import type { Profile } from '@al-yo-bo/shared';

import { NotFoundError, ValidationError } from '../errors.ts';

/** Validated avatar bytes; the extension was sniffed from magic bytes, not trust. */
export interface AvatarFile {
  bytes: Uint8Array;
  ext: 'jpg' | 'png';
}

/** Writes avatar bytes under the data root; returns the stored file name. */
export type AvatarStore = (file: AvatarFile) => Promise<string>;

export interface ProfileServiceDeps {
  db: Database;
  /** Avatar write port; absent = avatar upload is rejected, profile still usable. */
  avatarStore?: AvatarStore;
}

export interface ProfilePatchInput {
  name?: string | null;
  githubUsername?: string | null;
  activeDatasetId?: string | null;
}

export interface ProfileService {
  /** The singleton row, or null only when the schema was tampered with. */
  get(): Profile | null;
  update(patch: ProfilePatchInput): Profile;
  saveAvatar(file: AvatarFile): Promise<Profile>;
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { db, avatarStore } = deps;

  const requireProfile = (): Profile => {
    const profile = getProfile(db);
    if (!profile) {
      // Migration 0007 inserts the singleton row; a missing row means the
      // schema was tampered with — surface it as 404, not a crash.
      throw new NotFoundError('Profile not found');
    }
    return profile;
  };

  return {
    get: () => getProfile(db),

    update(patch) {
      requireProfile();
      if (patch.activeDatasetId !== undefined && patch.activeDatasetId !== null) {
        if (!getDatasetById(db, patch.activeDatasetId)) {
          throw new ValidationError('"activeDatasetId" must reference an existing dataset');
        }
      }
      // People type "@user"; store the bare username the API contract promises.
      const githubUsername =
        patch.githubUsername === undefined || patch.githubUsername === null
          ? patch.githubUsername
          : patch.githubUsername.replace(/^@/, '');
      updateProfile(db, { ...patch, githubUsername });
      return requireProfile();
    },

    async saveAvatar(file) {
      requireProfile();
      if (!avatarStore) {
        throw new ValidationError('Avatar storage is not configured');
      }
      const avatarPath = await avatarStore(file);
      updateProfile(db, { avatarPath });
      return requireProfile();
    },
  };
}
