// profile.helper.ts
import { Model, Types } from 'mongoose';
import { ProfileDocument } from 'src/profile/schema/profile.schema';

export async function getProfileByEntity<T extends { profileId: Types.ObjectId }>(
  model: Model<T>,
  entityId: string
): Promise<ProfileDocument | null> {
  const entity = await model.findById(entityId).populate('profileId').lean().exec();
  if (!entity || !entity.profileId) return null;
  console.log('[ProfileHelper] Retrieved profile for entityId:', entityId)
  return entity.profileId as ProfileDocument; 
}
