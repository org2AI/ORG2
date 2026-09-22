import { ORG2_CLOUD_OFFICIAL_SUPABASE_URL } from "@src/features/Org2Cloud/config";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const authFor = (userId = USER_A): Org2CloudAuthState => ({
  kind: "org2_cloud",
  supabaseUrl: ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
  supabaseAnonKey: "public-test",
  userId,
  accessToken: "test",
  refreshToken: "test",
  expiresAt: 9999999999,
});
export function signedInStore(userId = USER_A) {
  localStorage.clear();
  resetInstrumentedStore();
  const store = createInstrumentedStore();
  store.set(org2CloudAuthAtom, authFor(userId));
  return store;
}
