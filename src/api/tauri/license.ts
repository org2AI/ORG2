import { invoke } from "@tauri-apps/api/core";

/** Read the license text embedded in the running desktop application. */
export function readAppLicense(): Promise<string> {
  return invoke<string>("app_license_read");
}
